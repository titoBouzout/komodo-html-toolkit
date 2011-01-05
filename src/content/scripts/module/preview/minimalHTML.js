$toolkit.include('module.preview');
$toolkit.include('external.minimalHTML');

var MINIMAL_HTML_CONVERTER = new $toolkit.external.minimalHTML.minimalHTML.converter();

$self.controller = function() {

	// Call parent's constructor
	$toolkit.module.preview.controller.apply(this, [['HTML','HTML5','PHP','Text'], false, false, MINIMAL_HTML_CONVERTER.makeHtml, true, false]);
};

$self.registerAll = function() {

	new $self.controller().register();
};
