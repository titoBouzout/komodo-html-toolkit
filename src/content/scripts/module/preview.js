$toolkit.include('events');
$toolkit.include('htmlUtils');
$toolkit.include('io');

const Cc = Components.classes;
const Ci = Components.interfaces;

const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';

var PREVIEW_CACHED_TEMPLATES = [];
var PREVIEW_LAST_VIEW;

$self.destroy = function() {

	if ($self.dispatcher)
		$self.dispatcher.unregister();
};

$self.initialize = function() {

	$toolkit.events.onLoad($self.dispatcher.register);
};

$self.storage = new (function() {
	
	var nativeJSON = Cc['@mozilla.org/dom/json;1'].createInstance(Ci.nsIJSON);
	
	var timeNow = (function() { return Math.floor(new Date().getTime() / 1000); });
	
	var dbConnection, insertStatement, selectStatement, updateStatement;
	
	//made for reconnection on "library called out of sequence" errors
	this.connect = function()
	{
		// Open a connection to our database
		var storageFile = Cc['@mozilla.org/file/directory_service;1'].getService(Ci.nsIProperties).get('ProfD', Ci.nsIFile),
			storageService = Cc['@mozilla.org/storage/service;1'].getService(Ci.mozIStorageService);
	
		storageFile.append('html_toolkit_preview.sqlite');
	
		/** @type  Components.interfaces.mozIStorageConnection */
		dbConnection;
	
		try { dbConnection = storageService.openDatabase(storageFile); }
		catch (e) {
	
			// If the database was corrupted, remove it and start over
			if ('NS_ERROR_FILE_CORRUPTED' === e.name) {
	
				storageFile.remove(false);
				dbConnection = storageService.openDatabase(storageFile);
	
			} else
				throw e;
		}
	
		// Create tables if missing
		if ( ! dbConnection.tableExists('preview_options'))
			dbConnection.createTable('preview_options',
									 'id INTEGER NOT NULL PRIMARY KEY,\n'
								   + 'uri TEXT UNIQUE,\n'
								   + 'json_options TEXT,\n'
								   + 'timestamp INTEGER -- Unix time (local)\n');
	
		/** @type  Components.interfaces.mozIStorageStatement */
		var cleanUpStatement = dbConnection.createStatement('DELETE FROM preview_options WHERE timestamp < ?1');
			// Housekeeping, remove all items older than two weeks
			cleanUpStatement.bindInt32Parameter(0, timeNow() - (2 * 7 * 24 * 60 * 60));
			cleanUpStatement.executeStep();
			cleanUpStatement.reset();
			cleanUpStatement.finalize();
		
		/** @type  Components.interfaces.mozIStorageStatement */
		insertStatement = dbConnection.createStatement('INSERT INTO preview_options (uri, json_options, timestamp) VALUES (?1, ?2, ?3)');

		// Restore options for database, select on the fly keep memory usage low
		selectStatement = dbConnection.createStatement('SELECT json_options FROM preview_options where uri = ?1');
		updateStatement = dbConnection.createStatement('UPDATE preview_options set json_options = ?1, timestamp = ?2 where uri = ?3 ');
		
	};
	
	this.getViewUri = function(view) {

		if (view.document.file)
			return view.document.file.URI;
		return view.uid;//a new tab not saved yet?
	};

	this.getOptionsForView = function(view) {
	  
	  	selectStatement.bindUTF8StringParameter(0, $self.storage.getViewUri(view));
		selectStatement.executeStep();
		try {
		  
		  var viewOptions = nativeJSON.decode(selectStatement.getUTF8String(0));
		  
		}
		catch(e) {//it's ok, is not present in database
		  
		  if(dbConnection.lastError == 21) {//library routine called out of sequence
			
		  }
		  
		  var viewOptions = false;
		}
		selectStatement.reset();
		
		return viewOptions;
	};

	this.setOptionsForView = function(view, options) {
	
		$self.storage.saveOptionsForView(view, options);
	};

	this.saveOptionsForView = function(view, options) {

		try	{
		  
		  insertStatement.bindUTF8StringParameter(0, $self.storage.getViewUri(view));
		  insertStatement.bindUTF8StringParameter(1, nativeJSON.encode(options));
		  insertStatement.bindInt32Parameter(2, timeNow())
  
		  insertStatement.executeStep();
		  insertStatement.reset();
		}
		catch(e) {
		  
		  if(dbConnection.lastError == 21) {//library routine called out of sequence

			$self.storage.connect();
			$self.storage.saveOptionsForView(view, options);
			
		  } else {//it's ok, uri is on database, update instead

			updateStatement.bindUTF8StringParameter(0, nativeJSON.encode(options));
			updateStatement.bindInt32Parameter(1, timeNow())
			updateStatement.bindUTF8StringParameter(2, $self.storage.getViewUri(view));
	
			updateStatement.executeStep();
			updateStatement.reset();
		  }
		}
	};
	
	this.connect();
	
	$toolkit.events.onUnload(function() {

		// Finalize all statements
		insertStatement.finalize();
		selectStatement.finalize();
		updateStatement.finalize();
		// Explicitly close our connection to the database
		dbConnection.close();
	});

})();

$self.dispatcher = {

	converters: [],
	
	// Cache these as used every 0.5 seconds
	osService: Cc['@activestate.com/koOs;1'].getService(Ci.koIOs),
	pathService: Cc['@activestate.com/koOsPath;1'].getService(Ci.koIOsPath),
	
	register: function() {

		// Listen for buffer changes
		window.addEventListener('current_view_changed', $self.dispatcher.onViewChanged, true);
		window.addEventListener('current_view_language_changed', $self.dispatcher.onViewChanged, true);
		window.addEventListener('view_closing', $self.dispatcher.onViewClosing, true);

		// Simulate 'view_changed' event on current view
		if (ko.views.manager.currentView)
			$self.dispatcher.onViewChanged({ originalTarget: ko.views.manager.currentView });
	},

	unregister: function() {

		// Remove all installed timers first
		$self.dispatcher.uninstallAll();

		// Unload all events on Komodo shutdown
		window.removeEventListener('current_view_changed', $self.dispatcher.onViewChanged, true);
		window.removeEventListener('current_view_language_changed', $self.dispatcher.onViewChanged, true);
		window.removeEventListener('view_closing', $self.dispatcher.onViewClosing, true);
	},

	addConverter: function(obj) {

		var index = $self.dispatcher.indexOfConverter(obj);
		if (index < 0) {

			$self.dispatcher.converters.push(obj);
			return $self.dispatcher.converters.length;
		}

		return index;
	},

	removeConverter: function(obj) {

		var index = $self.dispatcher.indexOfConverter(obj);
		if (index >= 0)
			return $self.dispatcher.converters.splice(index, 1);

		return null;
	},

	indexOfConverter: function(obj) {

		for (var index = 0; index < $self.dispatcher.converters.length; index ++)
			if ($self.dispatcher.converters[index] === obj)
				return index;

		return -1;
	},

	onViewChanged: function(e) {

		var view = e.originalTarget;
		//enabled to all view types (allow puts the buttons on disabled)
		$self.dispatcher.checkAndInstall(view);
	},
	
	onViewClosing: function(e) {

		// Remove all custom XUL and timers before Komodo destroys the view
		var view = e.originalTarget;
		$self.dispatcher.previewHide(view);
		$self.dispatcher.uninstall(view);
	},
	
	//hide the preview of the last view ( if any )
	//checks if the XUL for this preview is there, if not put the preview in place (if enabled)
	//load the preview if not loaded
	//can be called directly with options to set a preview for a view
	checkAndInstall: function(view, options) {

	  if(!view && ko.views.manager && ko.views.manager.currentView)
		view = ko.views.manager.currentView;
	  if(!view)
		return;
	  
	  $self.dispatcher.previewHide(PREVIEW_LAST_VIEW);
	  
		if (!view.__preview_installed && view.document)
		  $self.dispatcher.install(view, options);
		if (!options){}
		else
		{
		  //fix: user selected url, file or interpret option  but view is on "code"
		  if(view['__preview_box'].getAttribute('viewType') == 'code' && !options.viewType)
			options.viewType = 'split';

		  //save old preferences not already saved ( example the box new width )
		  $self.storage.setOptionsForView(view, {
												  state: view['__preview_splitter'].getAttribute('state'),
												  width: view['__preview_box'].getAttribute('width'),
												  height: view['__preview_box'].getAttribute('height'),
												  viewType: view['__preview_box'].getAttribute('viewType'),
												  viewRender: view['__preview_box'].getAttribute('viewRender'),
												  viewPosition: view['__preview_box'].getAttribute('viewPosition')
											});
		  $self.dispatcher.previewLoad(view, options);
		}
		
	  $self.dispatcher.previewShow(view);
	  $self.dispatcher.updateUIToolbarbuttons(view);
	},
	//sets the XUL preview for this view ( if enable )
	install: function(view, options) {

		if ( ! view.__preview_installed &&  ! view.__preview_installing) { 
				  
			view.__preview_installing = true;
			
			//user wants to change a preference?
			if(!options)
			  options = $self.storage.getOptionsForView(view);

			//there is no settings for this file (do nothing)
			if(!options)
			{
			  view.__preview_installing = false;
			  return;
			}

			//creates and appends the XUL preview
			var splitterEl, grippyEl, boxEl, frameEl;
			
			  splitterEl = document.createElementNS(XUL_NS, 'splitter');
			  grippyEl = document.createElementNS(XUL_NS, 'grippy');
			  boxEl = document.createElementNS(XUL_NS, 'vbox');
			  closeEl = document.createElementNS(XUL_NS, 'toolbarbutton');

			  frameEl = document.createElementNS(XUL_NS, 'browser');//browser has loadURIWithFlags
			  frameEl.setAttribute('type', 'content-targetable');
			  frameEl.setAttribute('disablehistory', true);
			  //frameEl.setAttribute('context', 'contentAreaContextMenu');//TODO
			  frameEl.setAttribute('flex', 1);
			  
			  splitterEl.appendChild(grippyEl);
			  splitterEl.setAttribute('state', 'open');
			  splitterEl.setAttribute('hidden', true);
			  splitterEl.setAttribute('persist', 'state');
			 // splitterEl.firstChild.setAttribute('flex', '1');//makes the splitter clickeable
			  
			  boxEl.setAttribute('persist', 'collapsed');

			boxEl.appendChild(frameEl);
			
			//initial position
			var element = document.getElementById('tabbed-view').firstChild.nextSibling;
				element.parentNode.insertBefore(boxEl,  element);
				element.parentNode.insertBefore(splitterEl,  element);
					
			//reference elements
			view.__preview_box = boxEl;
			view.__preview_box.view = view;
			view.__preview_splitter = splitterEl;
			view.__preview_text = '';
			view.__preview_installed = true;
			
			//first load
			$self.dispatcher.previewLoad(view, options);
			
			view.__preview_installing = false;

		}
	},

	uninstall: function(view) {

		if (view.__preview_installed) {

			$self.storage.setOptionsForView(view, {
													state: view['__preview_splitter'].getAttribute('state'),
													width: view['__preview_box'].getAttribute('width'),
													height: view['__preview_box'].getAttribute('height'),
													viewType: view['__preview_box'].getAttribute('viewType'),
													viewRender: view['__preview_box'].getAttribute('viewRender'),
													viewPosition: view['__preview_box'].getAttribute('viewPosition')
												  });
			
			$self.dispatcher.endPeriodicalPreview(view);

			view.__preview_box.parentNode.removeChild(view.__preview_splitter);
			view.__preview_box.parentNode.removeChild(view.__preview_box);

			delete view['__preview_splitter'];
			delete view['__preview_box'];
			delete view['__preview_text'];
			delete view['__preview_installed'];
			delete view['__preview_installing'];
		}
	},

	uninstallAll: function() { 

		var editorViews = ko.views.manager.topView.getViewsByType(true, 'editor');
		for (var i = 0; i < editorViews.length; i ++)
			$self.dispatcher.uninstall(editorViews[i]);
	},

	//loads or changes the preferences for a preview
	previewLoad: function(view, options)
	{
		var viewOptions = $self.storage.getOptionsForView(view);

		if(!viewOptions) //very first time this preview loads for this document
		  viewOptions = {};

		if(!options)//no new preferences for this preview.
		  options = {};
		  
		//remove listener
		$self.dispatcher.endPeriodicalPreview(view);
		view.__preview_text = '';//fix: when the preview changes position but keeps type "interprete" the frame gets blank.
		  
	  //use: new or saved or default preferences
		
		if(options.viewType)//pref changed via argument
		  viewOptions.viewType = options.viewType;
		else if(!viewOptions.viewType)//no saved pref, use default
		  viewOptions.viewType = $toolkit.pref('preview.type');

		if(options.viewRender)//pref changed via argument
		  viewOptions.viewRender = options.viewRender;
		else if(!viewOptions.viewRender)//no saved pref, use default
		  viewOptions.viewRender = $toolkit.pref('preview.render');
		  
		if(options.viewPosition)//pref changed via argument
		  viewOptions.viewPosition = options.viewPosition;
		else if(!viewOptions.viewPosition)//no saved pref, use default
		  viewOptions.viewPosition = $toolkit.pref('preview.position');
		
	  //check if there is a need to acomodate UI
	  
		//elements
		var boxEl	   = view.__preview_box;
		var frameEl	   = view.__preview_box.firstChild;
		var splitterEl = view.__preview_splitter;

		frameEl.removeEventListener('load', $self.dispatcher.listenerRestoreScroll, true);
		frameEl.addEventListener('load', $self.dispatcher.listenerRestoreScroll, true);

		//fix for when the spliter is moved from left, right <> below, above
		splitterEl.removeAttribute('orient');
		
		//normal code view
		if(viewOptions.viewType == 'code' || !viewOptions.viewType)	{
		  
		  $self.dispatcher.previewHide(view);

		}
		//"full screen preview"
		else if(viewOptions.viewType == 'design') {
			  
			//move elements
			  var element = document.getElementById('tabbed-view').firstChild.nextSibling;
				  element.parentNode.insertBefore(boxEl,  element);
				  element.parentNode.insertBefore(splitterEl,  element);
				  
		}
		else if(viewOptions.viewType == 'split') {

		  //move to relevant position
			  
			  if(viewOptions.viewPosition == 'right') {
				
				var element = document.getElementById('editorviewbox');
					element.parentNode.insertBefore(boxEl,  element.nextSibling);
					element.parentNode.insertBefore(splitterEl,  element.nextSibling);
					//fix position
					splitterEl.setAttribute('collapse', 'after');
					//make the thing more clickeable
					splitterEl.firstChild.setAttribute('width', '10');
			  }
			  else if( viewOptions.viewPosition == 'left') {
				
				var element = document.getElementById('editorviewbox');
					element.parentNode.insertBefore(boxEl,  element);
					element.parentNode.insertBefore(splitterEl,  element);
					//fix position
					splitterEl.setAttribute('collapse', 'before');
					//make the thing more clickeable
					splitterEl.firstChild.setAttribute('width', '10');
			  }
			  else if(viewOptions.viewPosition == 'above') {
				
				var element = document.getElementById('tabbed-view').firstChild.nextSibling;
					element.parentNode.insertBefore(splitterEl,  element);
					element.parentNode.insertBefore(boxEl,  splitterEl);
					//fix position
					splitterEl.setAttribute('collapse', 'before');
					//make the thing more clickeable
					splitterEl.firstChild.setAttribute('height', '10');

			  }
			  else if(viewOptions.viewPosition == 'below') {
				
				var element = document.getElementById('tabbed-view');
					element.appendChild(splitterEl);
					element.appendChild(boxEl);
					//fix position
					splitterEl.setAttribute('collapse', 'after');
					//make the thing more clickeable
					splitterEl.firstChild.setAttribute('height', '10');
			  }
			  
		  //set sizes

			//width is important here
			
			  if(viewOptions.viewPosition == 'right' || viewOptions.viewPosition == 'left') {
				
				if (viewOptions.width && viewOptions.width > 0)
					boxEl.width = viewOptions.width;
				else
					boxEl.width = 200;
					
			  }
			
			//height is important here
			
			  if(viewOptions.viewPosition == 'above' || viewOptions.viewPosition == 'below') {
				
				if (viewOptions.height && viewOptions.height > 0)
					boxEl.height = viewOptions.height;
				else
					boxEl.height = 200;
					
			  }
		}
		
		if(viewOptions.state)
		  splitterEl.setAttribute('state', viewOptions.state);
		
		//save new options (example: the user has changed type from split to code[from toolbarbutton])
		$self.storage.setOptionsForView(view, {
												state: splitterEl.getAttribute('state'),
												width: boxEl.getAttribute('width'),
												height: boxEl.getAttribute('height'),
												viewType: viewOptions.viewType,
												viewRender:viewOptions.viewRender,
												viewPosition: viewOptions.viewPosition
											  });
		//render load type
		if(viewOptions.viewType != 'code')
		{
		  //if the render type has changed
		  if(
			 !boxEl.hasAttribute('viewRender') ||
			 viewOptions.viewRender != boxEl.getAttribute('viewRender') ||
			 boxEl.getAttribute('viewType') == 'code'
		  )
		  {
			//use file | TODO: new tabs with unsaved documents do not contains file.URI ( make a temporal )
			if(viewOptions.viewRender == 'file' && view.document && view.document.file && view.document.file.URI) {
			  
			  frameEl.setAttribute('src', 'about:blank');
			  frameEl.setAttribute('originalSRC', view.document.file.URI);
			  frameEl.setAttribute('src', view.document.file.URI);

			}
			else if(viewOptions.viewRender == 'url') {

			  var url = view._getPreviewPath();
			  if(!url || url == '')  {
				  url = view.document.file.URI
			  }
			  frameEl.setAttribute('src', 'about:blank');
			  frameEl.setAttribute('originalSRC', url);
			  frameEl.setAttribute('src', url);

			}
			else if(viewOptions.viewRender == 'interpreted') {

				//on startup interpreted lose baseURI sometimes
				frameEl.setAttribute('src', 'about:blank');

				frameEl.removeEventListener('load', $self.dispatcher.listenerInterprete, true);
				frameEl.addEventListener('load', $self.dispatcher.listenerInterprete, true);

				
			  /***SRC***/
			  
				//fix for base URI for live preview of "interpreted HTML"
				//creates a temporal file with the content, sets the SRC of the iframe to that file
				//and appends the baseURI to the document.
				//this file is created when the browser is shown the first time, next updates comes from innerHTML.
				var src = this.fileCreateTemporal(view.scimoz.text);
				
				//resolve URI src for temporal file
				var ios = Components.classes["@mozilla.org/network/io-service;1"].  
							  getService(Components.interfaces.nsIIOService);
							  
				var file = Components.classes["@mozilla.org/file/local;1"].  
							createInstance(Components.interfaces.nsILocalFile);  
					file.initWithPath(src);
				
				  src = ios.newFileURI(file).spec;
				
			  /***baseURI***/
			  
				var base;
				if ($self.dispatcher.pathService.isfile(view.document.displayPath))
					base = $self.dispatcher.pathService.dirname(view.document.displayPath) + $self.dispatcher.osService.sep;
				else//a new tab not saved yet?
					base = $self.dispatcher.osService.getcwd() + $self.dispatcher.osService.sep;
				
				//from path to uri
				file.initWithPath(base);
				  
				base = ios.newFileURI(file).spec;

				frameEl.setAttribute('xbaseURI', base);
				frameEl.setAttribute('originalSRC', src);
				frameEl.setAttribute('src', src);

			}//ends viewOptions.viewRender == 'interpreted'
		  }//ends if the render type has changed
		}//ends if render type != code
		
		boxEl.setAttribute('viewType', viewOptions.viewType);
		boxEl.setAttribute('viewRender', viewOptions.viewRender);
		boxEl.setAttribute('viewPosition', viewOptions.viewPosition);
		
		if(viewOptions.viewType != 'code')
		{
		  if(viewOptions.viewRender != 'interpreted')
		  {
			//auto-refresh view
			$self.dispatcher.beginPeriodicalPreview(view);
		  }
		  else
		  {
			//if interpreted were moved update
			frameEl.removeEventListener('load', $self.dispatcher.listenerInterprete, true);
			frameEl.addEventListener('load', $self.dispatcher.listenerInterprete, true);
		  }
		}
	},
	//restore scroll
	listenerRestoreScroll : function(e)
	{
	  e.currentTarget.removeEventListener('load', $self.dispatcher.listenerRestoreScroll, true);
		
	  $self.dispatcher.frameSetScroll( e.currentTarget, 
									 [ e.currentTarget.parentNode.getAttribute('preview.scrollTop'),
									  e.currentTarget.parentNode.getAttribute('preview.scrollLeft')]
									);
	},
	listenerInterprete : function(e)
	{
	  e.currentTarget.parentNode.view.__preview_text = '';//fix: document loaded after preview were injected. preview_text unset to notify the refresh listener that the injection should be "refreshed"
	  e.currentTarget.removeEventListener('load', $self.dispatcher.listenerInterprete, true);
	  $self.dispatcher.displayPreview(e.currentTarget.parentNode.view);
	  $self.dispatcher.frameSetScroll(e.currentTarget,
									  [e.currentTarget.parentNode.getAttribute('preview.scrollTop'),
									   e.currentTarget.parentNode.getAttribute('preview.scrollLeft')]);
	  $self.dispatcher.beginPeriodicalPreview(e.currentTarget.parentNode.view);


	},
	///outputs text to the command output window
	//http://community.activestate.com/faq/how-do-you-write-command-output-window
	commandOutput : function(aString)
	{
		// First make sure the command output window is visible
       // ko.run.output.show(window, false);
        // Second, make sure we're showing the output pane, not the error list pane.
        var deckWidget = document.getElementById("runoutput-deck");
        if (deckWidget.getAttribute("selectedIndex") != 0) {
            ko.run.output.toggleView();
        }
        // Now find out which newline sequence the window uses, and write the
        // text to it.
        var scimoz = document.getElementById("runoutput-scintilla").scimoz;
        var prevLength = scimoz.length;
        var currNL = ["\r\n", "\n", "\r"][scimoz.eOLMode];
        var full_str = aString + currNL;
        var full_str_byte_length = ko.stringutils.bytelength(full_str);
        var ro = scimoz.readOnly;
        try {
            scimoz.readOnly = false;
            scimoz.appendText(full_str_byte_length, full_str);
        } finally {
            scimoz.readOnly = ro;
        }
        // Bring the new text into view.
       // scimoz.gotoPos(prevLength + 1);
	},
	//controls XUL to show and what to hide for a viewType ( if enabled )
	previewShow: function(view) {

	  PREVIEW_LAST_VIEW = view;
	  
	  if(!view || !view.__preview_installed){}
	  else {
		  
		view.__preview_box.firstChild.removeEventListener('load', $self.dispatcher.listenerRestoreScroll, true);
		view.__preview_box.firstChild.addEventListener('load', $self.dispatcher.listenerRestoreScroll, true);
		  
		  if(view.__preview_box.getAttribute('viewType') == 'code') {
			
			//show editor
			document.getElementById('tabbed-view')
			  .getElementsByTagName('xul:tabpanels')[0].setAttribute('collapsed', false);
			  
			 $self.dispatcher.endPeriodicalPreview(view);
			
		  }
		  else if(view.__preview_box.getAttribute('viewType') == 'design') {
			
			view.__preview_box.setAttribute('hidden', false);
			view.__preview_box.setAttribute('flex', '1');
			view.__preview_splitter.setAttribute('hidden', true);
			
			//hide editor
			document.getElementById('tabbed-view')
			  .getElementsByTagName('xul:tabpanels')[0].setAttribute('collapsed', true);
			
			//restore scroll
			$self.dispatcher.frameSetScroll(view.__preview_box.firstChild,
											[
											  view.__preview_box.getAttribute('preview.scrollTop'),
											  view.__preview_box.getAttribute('preview.scrollLeft')
											]);
			if(view.__preview_box.getAttribute('viewRender') != 'interpreted')
			  $self.dispatcher.beginPeriodicalPreview(view);
			
		  } else { //split 

			view.__preview_box.removeAttribute('flex');
			view.__preview_box.setAttribute('hidden', false);
			view.__preview_splitter.setAttribute('hidden', false);

			//show editor
			document.getElementById('tabbed-view')
			  .getElementsByTagName('xul:tabpanels')[0].setAttribute('collapsed',  false);
			
			//restore scroll
			/*$self.dispatcher.frameSetScroll(view.__preview_box.firstChild,
											[
											  view.__preview_box.getAttribute('preview.scrollTop'),
											  view.__preview_box.getAttribute('preview.scrollLeft')
											]);*/
			
			if(view.__preview_box.getAttribute('viewRender') != 'interpreted')
			  $self.dispatcher.beginPeriodicalPreview(view);
		  }
		  var nsIWebNavigation = Components.interfaces.nsIWebNavigation;
		  try{
		  view.__preview_box.firstChild.loadURIWithFlags(
														  view.__preview_box.firstChild.getAttribute('originalSRC'), 
														  nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY |
														  nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
		  }
		  catch(e){}//fix: browser hidden or collapsed.
	  }	  
	},
	//hides the preview for a view (if any)
	previewHide: function(view) {

	  if(!view || !view.__preview_installed){}
	  else {
		
		//save scroll ( for session )
		var scroll = $self.dispatcher.frameGetScroll(view.__preview_box.firstChild);
		view.__preview_box.setAttribute('preview.scrollTop', scroll[0]);
		view.__preview_box.setAttribute('preview.scrollLeft', scroll[1]);
		
	  	view.__preview_box.setAttribute('hidden', true);

		view.__preview_splitter.setAttribute('hidden', true);
		document.getElementById('tabbed-view').getElementsByTagName('xul:tabpanels')[0].setAttribute('collapsed', false);
		
		$self.dispatcher.endPeriodicalPreview(view);
		
	  }
	},
	//updates the state of the toolbabuttons

	updateUIToolbarbuttons:function(view) {

	  document.getElementById('htmltoolkit_preview_type_code').setAttribute('checked', false);
	  document.getElementById('htmltoolkit_preview_type_design').setAttribute('checked', false);
	  document.getElementById('htmltoolkit_preview_type_split').setAttribute('checked', false);

	  if(!view.scimoz || view.getAttribute('type') != 'editor' || !view.document || !view.document.file || !view.document.file.URI)
	  {
		document.getElementById('htmltoolkit_preview_type_code').setAttribute('disabled', true);
		document.getElementById('htmltoolkit_preview_type_design').setAttribute('disabled', true);
		document.getElementById('htmltoolkit_preview_type_split').setAttribute('disabled', true);
		document.getElementById('htmltoolkit_preview_options').setAttribute('disabled', true);
		
	  } else {
		
		document.getElementById('htmltoolkit_preview_type_code').setAttribute('disabled', false);
		document.getElementById('htmltoolkit_preview_type_design').setAttribute('disabled', false);
		document.getElementById('htmltoolkit_preview_type_split').setAttribute('disabled', false);
		document.getElementById('htmltoolkit_preview_options').setAttribute('disabled', false);
		
		if (!view.__preview_installed) {
		  
		  document.getElementById('htmltoolkit_preview_type_code').setAttribute('checked', true);
		
		} else {
  
		  document.getElementById('htmltoolkit_preview_type_'+view.__preview_box.getAttribute('viewType')).setAttribute('checked', true);
		  
		}
	  }
	},
	
  //updates the options menupoup on popupshowing
	
	updateUIOptionsMenu:function(menupopup) {

	  var view = ko.views.manager.currentView;
	  if(!view || !view.__preview_box)
		view = {};

	  //resolve current view options or defaults
	  var options = {};
	  
		if(view.__preview_box && view.__preview_box.hasAttribute('viewRender'))
		  options.viewRender = view.__preview_box.getAttribute('viewRender');
		else //no saved pref, use default
		  options.viewRender = $toolkit.pref('preview.render');
		
		if(view.__preview_box && view.__preview_box.hasAttribute('viewPosition'))
		  options.viewPosition = view.__preview_box.getAttribute('viewPosition');
		else //no saved pref, use default
		  options.viewPosition = $toolkit.pref('preview.position');

	  //check uncheck view pref or default pref
	  
	  var childNodes = menupopup.childNodes, accesskey;
	  for(var id=0;id<childNodes.length;id++) {
	  
		accesskey = childNodes[id].getAttribute('accesskey');
		
		//render type
		
		  if(accesskey == 'H' && options.viewRender == 'interpreted')
			childNodes[id].setAttribute('checked', true);
		  else if(accesskey == 'U' && options.viewRender == 'url')
			childNodes[id].setAttribute('checked', true);
		  else if(accesskey == 'F' && options.viewRender == 'file')
			childNodes[id].setAttribute('checked', true);
		  
		//position
		
		  else if(accesskey == 'A' && options.viewPosition == 'above')
			childNodes[id].setAttribute('checked', true);
		  else if(accesskey == 'R' && options.viewPosition == 'right')
			childNodes[id].setAttribute('checked', true);
		  else if(accesskey == 'L' && options.viewPosition == 'left')
			childNodes[id].setAttribute('checked', true);
		  else if(accesskey == 'B' && options.viewPosition == 'below')
			childNodes[id].setAttribute('checked', true);
		  else
			childNodes[id].setAttribute('checked', false);
	
	  }
	  
	},
	
	//saves the current options as defaults
	saveDefaultOptions:function() {


	  var view = ko.views.manager.currentView;
	  if(!view || !view.__preview_box)
		view = {};

	  //resolve current view options or defaults
	  var options = {};
	  
		if(view.__preview_box && view.__preview_box.hasAttribute('viewRender'))
		  options.viewRender = view.__preview_box.getAttribute('viewRender');
		else //no saved pref, use default
		  options.viewRender = $toolkit.pref('preview.render');
		
		if(view.__preview_box && view.__preview_box.hasAttribute('viewPosition'))
		  options.viewPosition = view.__preview_box.getAttribute('viewPosition');
		else //no saved pref, use default
		  options.viewPosition = $toolkit.pref('preview.position');

	  //set default refs
	  $toolkit.pref('preview.render',  options.viewRender);
	  $toolkit.pref('preview.position',  options.viewPosition);
	  
	},
	frameGetScroll:function(aFrame){

	  var scrollTop = 0;
	  var scrollLeft = 0;
	  
	  //save scroll
		try{
		  
		  //urls
		  if(aFrame.contentDocument && aFrame.contentDocument.documentElement)
		  {
			scrollTop  = aFrame.contentDocument.documentElement.scrollTop;
			scrollLeft = aFrame.contentDocument.documentElement.scrollLeft;
		  }
		  if(scrollTop == 0 && scrollLeft == 0 && aFrame.contentDocument && aFrame.contentDocument.body)
		  {
			//files://
			scrollTop = aFrame.contentDocument.body.scrollTop;
			scrollLeft = aFrame.contentDocument.body.scrollLeft;
		  }
		  if(scrollTop == 0 && scrollLeft == 0 && aFrame.contentWindow && aFrame.contentWindow.scrollY)
		  {
			//inyected html
			scrollTop = aFrame.contentWindow.scrollY;
			scrollLeft = aFrame.contentWindow.scrollX;
		  }
		  
		}catch(e){ }//ok, no document, or no body
	  
	  return [scrollTop, scrollLeft];
	},
	frameSetScroll:function(aFrame, scroll){

	  if(!scroll || (scroll[0] == 0 && scroll[1] == 0))
		return;
	  //set scroll
		try {//ok, no document, or no body
			
			if(aFrame.scrollTo)
			{
			  aFrame.scrollTo(scroll[1],scroll[0]);
			}
			else if(aFrame.contentDocument.scrollTo)
			{
			  aFrame.contentDocument.scrollTo(scroll[1],scroll[0]);
			}
			//file uri/http (example this javascript)
			else if(aFrame.contentDocument && aFrame.contentDocument.body)
			{
			  aFrame.contentDocument.body.scrollTop= scroll[0];
			  aFrame.contentDocument.body.scrollLeft= scroll[1];
			}
			else if(aFrame.contentWindow)
			{
			  //inyected html
			  aFrame.contentWindow.scrollTo(scroll[1],scroll[0]);
			}
			else if(aFrame.contentDocument && aFrame.contentDocument.documentElement)
			{
			  //no body:
			  aFrame.contentDocument.documentElement.scrollTop = scroll[0];
			  aFrame.contentDocument.documentElement.scrollLeft = scroll[1];
			}
			
		} catch(e) { }
	},

	beginPeriodicalPreview: function(view) {
		
		//allways ends periodical preview if were set
		if (view.__preview_intervalId) {
		 $self.dispatcher.endPeriodicalPreview(view);
		}
		 
		if(
		   view.__preview_box.getAttribute('viewRender') == 'url' ||
		   view.__preview_box.getAttribute('viewRender') == 'file'
		)
		{
		  
		  if ( ! view.__preview_intervalId) {
  
			  // check for document SAVING every 0.2 seconds
			  view.__preview_intervalId = window.setInterval(function() {
				
				  $self.dispatcher.periodicalRefreshPreview(view);
  
			  }, 150);
		  }
		  
		}
		else //interpreted HTML
		{
	
		  if ( ! view.__preview_intervalId && view.scimoz) {
  
			  // Preview every 0.15 seconds
			  view.__preview_intervalId = window.setInterval(function() {

				  //if (view.scimoz.isFocused || view.scimoz.focus)
				  //fix: the iframe has the focus, the iframe is moved from one position to another ;
				  //as scimoz is not focused the iframe ends blank (because iframes when set to hidden gets content removed on about:blanks URLs)
					  $self.dispatcher.displayPreview(view);
  
			  }, 120);//since the script checks if the converter is running with a boolean this don't affect performance
		  }
		}
	},
	//refresh the document when view is saved
	periodicalRefreshPreview: function(view){

	  if(view.isDirty)
	  {
		view.__preview_box.isDirty = true;
	  }
	  else if(view.__preview_box.isDirty)
	  {
		view.__preview_box.isDirty = false;
		
		var scroll = $self.dispatcher.frameGetScroll(view.__preview_box.firstChild);
  		view.__preview_box.setAttribute('preview.scrollTop', scroll[0]);
		view.__preview_box.setAttribute('preview.scrollLeft', scroll[1]);
		
		view.__preview_box.firstChild.removeEventListener('load', $self.dispatcher.listenerRestoreScroll, true);
		view.__preview_box.firstChild.addEventListener('load', $self.dispatcher.listenerRestoreScroll, true);
		   
		//reload
		  var nsIWebNavigation = Components.interfaces.nsIWebNavigation;
		  view.__preview_box.firstChild.loadURIWithFlags(
														  view.__preview_box.firstChild.getAttribute('originalSRC'), 
														  nsIWebNavigation.LOAD_FLAGS_BYPASS_PROXY |
														  nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE);
	  }
	},
	endPeriodicalPreview: function(view) {

		if (view.__preview_intervalId) {

			window.clearInterval(view.__preview_intervalId);
			delete view['__preview_intervalId'];
		}
	},

	displayPreview: function(view) {

		if (view.__preview_interpreted_running)
		 	return false;
		if(view.__preview_text === view.scimoz.text)
		  return false;
		view.__preview_interpreted_running = true;
		
		var htmlCode = view.__preview_text = view.scimoz.text;
		
		var tmp;
		var appendTemplateCSS = false;
		var aConverterFound = false;// used to apply defaults converters if none match
		var defaultConverters = []//holds defaults converters
		var converter;
		
		for (var i = 0; i < $self.dispatcher.converters.length; i ++) {

			converter = $self.dispatcher.converters[i];
			
			if(converter.applyToAny)
			  defaultConverters[defaultConverters.length] = converter;
			
			for(var id in converter.languages) {

			  if (converter.languages[id] === view.document.language) {
				
				if(converter.appendTemplateCSS)
				  appendTemplateCSS = true;
				  
				tmp = $self.dispatcher.applyConverter(view, converter, htmlCode)
				
				if(!tmp)
				{
				  view.__preview_interpreted_running = false;
				  return false;//converter failed
				}
				
				htmlCode = tmp;
				
				aConverterFound = true;
				
				break;//apply this converter one time
			  }
			}
			
		}
		
		//if no converter found, apply the marked as "apply to any"
		if(!aConverterFound)
		{
		  for(var id in defaultConverters)
		  {
			converter = defaultConverters[id];
		
			if(converter.appendTemplateCSS)
			  appendTemplateCSS = true;
			  
			tmp = $self.dispatcher.applyConverter(view, converter, htmlCode)
			
			if(!tmp)
			{
			  view.__preview_interpreted_running = false;
			  return false;//converter failed
			}
			
			htmlCode = tmp;
		  }
		}
		
		/* only apply css templates when language is marked to do that */
		var frameEl = view.__preview_box.firstChild;
		var baseURI = String(frameEl.getAttribute('xbaseURI'));

		if(appendTemplateCSS) {
		   try{ frameEl.contentDocument.documentElement.innerHTML = String($self.dispatcher.renderTemplate(view, 'page',	{ html: htmlCode, base:baseURI }));}catch(e){/*shh trying to preview an XUL or something like that.*/}

		} else {

		  try{ frameEl.contentDocument.documentElement.innerHTML = String('<base href="'+baseURI+'"/>'+htmlCode);}catch(e){/*shh trying to preview an XUL or something like that.*/}
			
		}
		
		view.__preview_interpreted_running = false;
		
		return true;
	},
	applyConverter: function(view, converter, HTML)
	{

	  var allowedLength = converter.allowedLength;
	  
	  if (view.scimoz.text.length > allowedLength) {

		  view.__preview_box.firstChild.contentDocument.documentElement.innerHTML =  String($self.dispatcher.renderTemplate(view, 'exception', { exception: $toolkit.l10n('module').formatStringFromName('preview.overAllowedLength', [allowedLength], 1) }));

		  return false;
	  }

	  try {

		  return String(converter.callback(view.scimoz.text));

	  } catch (e) {

		   view.__preview_box.firstChild.contentDocument.documentElement.innerHTML = String($self.dispatcher.renderTemplate(view, 'exception', { exception: e }));
		  
		  return false;
	  }

	},
	getCachedTemplate: function(name) {

		var templateKey = '$tpl:' + name;

		if (templateKey in PREVIEW_CACHED_TEMPLATES)
		{
			return PREVIEW_CACHED_TEMPLATES[templateKey];
		}

		// Allow templates to be localised
		var localeService = Cc['@mozilla.org/intl/nslocaleservice;1'].getService(Ci.nsILocaleService),
			applicationLocale = localeService.getApplicationLocale().getCategory('NSILOCALE_CTYPE'),
			templateLocales = [applicationLocale, 'en-US'];

		templateLocales.forEach(function(locale) {

			if (PREVIEW_CACHED_TEMPLATES[templateKey])
			{
				return false;
			}

			try {

				var templatePath = 'locale/' + locale + '/command/preview/' + name + '.html';
				var templateFile = $toolkit.io.getRelativeURI(templatePath, true);

				PREVIEW_CACHED_TEMPLATES[templateKey] = $toolkit.io.readEntireFile(templateFile);

			} catch (e) {}

			return true;
		});

		return PREVIEW_CACHED_TEMPLATES[templateKey];
	},
	
	//return html for a rendered template
	renderTemplate: function(view, name, args) {

		var template = $self.dispatcher.getCachedTemplate(name);

		if (args) {
			for (var key in args) {
				if (args.hasOwnProperty(key)) {

					template = String(template.replace('${' + key + ':safe}', args[key], 'g')
									   .replace('${' + key + '}', $toolkit.htmlUtils.escape(args[key]), 'g'));
				}
			}
		}

		return template;
	},
	
	//this is important to deal with the baseURI for preview type "interpreted"
	//TODO:use a koFile object or move this to another place
	fileCreateTemporal: function(aData) {
	  
		if(!aData)
			aData = '';
		//WTF!!!!!!!!!!!!!!!!!!!!?
		var file = Components.classes["@mozilla.org/file/directory_service;1"]
						 .getService(Components.interfaces.nsIProperties)
						 .get("TmpD", Components.interfaces.nsIFile);
		//security - works always in a folder with with the name of this extension
		file.append('htmltoolkit.preview');
		if( !file.exists() || !file.isDirectory() )   // if it doesn't exist, create
		{
			file.create(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0775);
		}
		file.append('interpreted.html');
		file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0775);
		
		var WriteStream = Components.classes["@mozilla.org/network/file-output-stream;1"]
							.createInstance(Components.interfaces.nsIFileOutputStream);
		// use 0x02 | 0x10 to open file for appending.
		WriteStream.init(file, 0x02 | 0x08 | 0x20, 0644, 0); // write, create, truncate
			
		var why_not_a_simple_fopen_fwrite = Components.classes["@mozilla.org/intl/converter-output-stream;1"]
												.createInstance(Components.interfaces.nsIConverterOutputStream);
		
		why_not_a_simple_fopen_fwrite.init(WriteStream, "utf-8", 0, 0xFFFD); // U+FFFD = replacement character
		why_not_a_simple_fopen_fwrite.writeString(aData);
		why_not_a_simple_fopen_fwrite.close();
		WriteStream.close();
		
		var path =  file.path;
		
		return path;
	}
};

$toolkit.trapExceptions($self.dispatcher);

$self.controller = function(languages, interval, allowedLength, callback, applyToAny, appendTemplateCSS) {

	this.languages = languages;
	this.applyToAny = (!applyToAny ? false : true );//used when no converter for a document were found.
	this.appendTemplateCSS = (!appendTemplateCSS ? false : true );
	this.interval = (interval || 500);
	this.allowedLength = (allowedLength || 640 /* lines */ * 80 /* chars per column */);
	this.callback = (callback || function(text) { return text; });

	this.register = function() { $self.dispatcher.addConverter(this); };

	this.unregister = function() { $self.dispatcher.removeConverter(this); };
};

$self.registerAll = function() {

	$toolkit.registerAll(__namespace__);
};
