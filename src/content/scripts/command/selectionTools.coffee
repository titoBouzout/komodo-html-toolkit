root = $toolkit ? this

`const Cc = Components.classes`
`const Ci = Components.interfaces`

`const XUL_NS = 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul'`

$self.destroy: ->
  $self.manager.unregister() if $self.manager?
  true

$self.manager: {

  tools: []

  register: ->
  unregister: ->

  changeHandler: null

  addTool: (obj) ->
    index: $self.manager.indexOfTool obj
    if index < 0
      $self.manager.tools.push obj
      $self.manager.sortTools()
      @onChange()
      return $self.manager.tools.length
    return index

  removeTool: (obj) ->
    index: $self.manager.indexOfTool obj
    if index >= 0
      tool: $self.manager.tools.splice index, 1
      $self.manager.sortTools()
      @onChange()
      return tool
    return null

  indexOfTool: (obj) ->
    for index in [0...$self.manager.tools.length]
      return index if $self.manager.tools[index] is obj
    return -1

  sortTools: ->
    $self.manager.tools.sort (left, right) ->
      return -1 if left.ordering < right.ordering
      return +1 if left.ordering > right.ordering
      return 0

  onChange: (handler) ->
    if handler?
      return @changeHandler: handler
    else if @changeHandler?
      return @changeHandler()
    null
}

root.trapExceptions $self.manager

TOOL_ORDERING: 9900
TOOL_COMMANDS_GROUP: 'cmd_htmlToolkit_selectionTools_'

$self.tool: (toolName, toolOrdering) ->
  @name: toolName
  @ordering: toolOrdering ? (++ TOOL_ORDERING)

  @register: ( -> $self.manager.addTool @)
  @unregister: ( -> $self.manager.removeTool @)

  @getSupportedTransformers: ( -> [])
  @trigger: (transformer) -> null

  this

encodingService: Cc['@activestate.com/koEncodingServices;1'].getService(Ci.koIEncodingServices)

$self.controller: ->

  root.command.controller.apply @, [command: 'selectionTools',
                                    triggerKeys: 'None',
                                    canChangeTriggerKeys: false]

  @canExecute: (e) ->
    return ko.views.manager and
           ko.views.manager.currentView and
           ko.views.manager.currentView.getAttribute('type') is 'editor' and
           ko.views.manager.currentView.document and
           ko.views.manager.currentView.scimoz and
           ko.views.manager.currentView.scimoz.currentPos isnt ko.views.manager.currentView.scimoz.anchor

  @rebuildEditMenu: ->
    globalSet: document.getElementById 'broadcasterset_global'
    if not globalSet?
      throw "FATAL: Cannot find Komodo's global broadcaster set."

    Array::slice(globalSet.childNodes).forEach (broadcasterEl) ->
      if broadcasterEl.id?.indexOf(TOOL_COMMANDS_GROUP) is 0
        globalSet.removeChild broadcasterEl
      null

    topMenuEl: document.getElementById 'menu_selectionTools'
    topMenuEl.parentNode.removeChild topMenuEl if topMenuEl?

    topMenuEl: document.createElementNS XUL_NS, 'menu'
    topMenuEl.setAttribute 'id', 'menu_selectionTools'
    topMenuEl.setAttribute 'label', root.l10n('command').GetStringFromName 'selectionTools.menuLabel'
    topMenuEl.setAttribute 'accesskey', root.l10n('command').GetStringFromName 'selectionTools.menuAccessKey'

    popupEl: document.createElementNS XUL_NS, 'menupopup'
    popupEl.setAttribute 'id', 'popup_selectionTools'

    isMac: navigator.platform.indexOf('Mac') >= 0

    $self.manager.tools.forEach (tool) ->
      tool.getSupportedTransformers().forEach (transformer) ->

        commandName: "$TOOL_COMMANDS_GROUP${tool.name}_$transformer"
        commandLabel: root.l10n('command').GetStringFromName "selectionTools.${tool.name}.${transformer}.menuLabel"
        commandAccessKey: root.l10n('command').GetStringFromName "selectionTools.${tool.name}.${transformer}.menuAccessKey"
        commandDescription: root.l10n('command').formatStringFromName 'selectionTools.binding', [commandLabel], 1

        # Register command as new broadcaster
        broadcasterEl: document.createElementNS XUL_NS, 'broadcaster'
        broadcasterEl.setAttribute 'id', commandName
        broadcasterEl.setAttribute 'key', "key_$commandName"
        broadcasterEl.setAttribute 'oncommand', "ko.commands.doCommandAsync('$commandName', event);"
        broadcasterEl.setAttribute 'desc', commandDescription

        globalSet.appendChild broadcasterEl

        # Set default key binding, if specified
        try
          # Make sure the User has not overridden the default key bindings
          existingKeyBindings: gKeybindingMgr.command2keysequences commandName
          if not existingKeyBindings.length
            triggerKeys: root.l10n('command').GetStringFromName "selectionTools.${tool.name}.${transformer}.triggerKeys"
            # Ctrl is Meta on a Mac, update assigned triggers keys to match
            triggerKeys: triggerKeys.replace 'Ctrl', 'Meta', 'g' if isMac
            triggerKeys: triggerKeys.split(',').map (key) -> key.replace /^\s+|\s+$/, ''
            defaultKeyBindings: {}
            defaultKeyBindings[commandName]: triggerKeys
            gKeybindingMgr._add_keybinding_sequences defaultKeyBindings
        catch e
          # ignore

        menuEl: document.createElementNS XUL_NS, 'menuitem'
        menuEl.setAttribute 'label', commandLabel
        menuEl.setAttribute 'id', "menu_${tool.name}_$transformer"
        menuEl.setAttribute 'accesskey', commandAccessKey
        menuEl.setAttribute 'observes', commandName
        popupEl.appendChild menuEl

      separatorEl: document.createElementNS XUL_NS, 'menuseparator'
      popupEl.appendChild separatorEl

    # Remova last separator
    popupEl.removeChild popupEl.childNodes[popupEl.childNodes.length - 1] if popupEl.childNodes.length

    topMenuEl.appendChild popupEl

    referenceEl: document.getElementById 'menu_marks'
    referenceEl.parentNode.insertBefore topMenuEl, referenceEl.nextSibling

  @onMenuShowing: ->
    topMenuEl: document.getElementById 'menu_selectionTools'
    topMenuEl.setAttribute('disabled', if @canExecute false then 'false' else 'true')

  @moveBuiltInMenuItems: ->
    popupEl: document.getElementById 'popup_selectionTools'

    convertLowerCaseEl: document.getElementById 'menu_convertLowerCase'
    popupEl.insertBefore convertLowerCaseEl.nextSibling, popupEl.firstChild
    popupEl.insertBefore convertLowerCaseEl, popupEl.firstChild

    convertUpperCaseEl: document.getElementById 'menu_convertUpperCase'
    popupEl.insertBefore convertUpperCaseEl, popupEl.firstChild

  @restoreBuiltInMenuItems: ->
    referenceEl: document.getElementById 'menu_selectionTools'
    if referenceEl
      referenceEl: referenceEl.nextSibling
    else
      referenceEl: document.getElementById 'menu_marks'

    convertLowerCaseEl: document.getElementById 'menu_convertLowerCase'
    referenceEl.parentNode.insertBefore convertLowerCaseEl.nextSibling, referenceEl.nextSibling
    referenceEl.parentNode.insertBefore convertLowerCaseEl, referenceEl.nextSibling

    convertUpperCaseEl: document.getElementById 'menu_convertUpperCase'
    referenceEl.parentNode.insertBefore convertUpperCaseEl, referenceEl.nextSibling

  @registerBase: @register
  @register: ->
    $self.manager.onChange =>
      @rebuildEditMenu()

    root.events.onLoad =>
      @rebuildEditMenu()
      @moveBuiltInMenuItems()

      menuEl: document.getElementById 'popup_sourcecode'
      menuEl.addEventListener 'popupshowing', @onMenuShowing, false

      window.controllers.appendController @

    @registerBase()

  @unregisterBase: @unregister
  @unregister: ->
    root.events.onUnload =>
      menuEl: document.getElementById 'popup_sourcecode'
      menuEl.removeEventListener 'popupshowing', @onMenuShowing, false

      @restoreBuiltInMenuItems()

      window.controllers.removeController @

    @unregisterBase()

  @supportsCommand: (command) ->
    return true if command.indexOf(TOOL_COMMANDS_GROUP) is 0
    return false

  @isCommandEnabled: (command) ->
    return @canExecute false if command.indexOf(TOOL_COMMANDS_GROUP) is 0
    return false

  @doCommand: (command) ->
    if @isCommandEnabled(command)
      [toolName, transformer]: command.substr(TOOL_COMMANDS_GROUP.length).split '_'
      $self.manager.tools.forEach (tool) ->
        if tool.name is toolName
          scimoz: ko.views.manager.currentView.scimoz
          inputString: scimoz.selText
          outputString: tool.trigger transformer, inputString
          if typeof outputString is 'string' and outputString.length
            selectionDirection: scimoz.currentPos > scimoz.anchor
            scimoz.beginUndoAction()
            try
              scimoz.replaceSel outputString
              if selectionDirection
                scimoz.setSel scimoz.currentPos - ko.stringutils.bytelength(outputString), scimoz.currentPos
              else
                scimoz.setSel scimoz.currentPos, scimoz.currentPos - ko.stringutils.bytelength(outputString)
            finally
              scimoz.endUndoAction()
          else
            commandLabel: root.l10n('command').GetStringFromName "selectionTools.${tool.name}.${transformer}.menuLabel"
            ko.statusBar.AddMessage root.l10n('command').formatStringFromName('selectionTools.invalidSelection', [commandLabel], 1), 'htmltoolkit', 2500, true
        null
    null

  root.trapExceptions @

  this

$self.registerAll: ->
  root.registerAll __namespace__
  new $self.controller().register()