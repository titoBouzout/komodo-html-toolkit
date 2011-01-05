//
// minimalHTML.js -- A very minimal HTML converter. Escapes foreing languages. Currenlty only PHP
//
// Author: Roberto Bouzout.
//
// GNU/GPL


var minimalHTML = {};

minimalHTML.converter = function() {

this.makeHtml = function(text) {

  /*PHP : minimal language escape...*/
  
	text = String('    '+text);
	
	if(text.indexOf('<?') != -1)
	{
	  var blocks = String(text).split('<?');
	  
	  for(var id=1;id<blocks.length;id++)
	  {
		var block = blocks[id].split('?>');
			block[0] = block[0].split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;').split("'").join('&apos;');
			
			blocks[id] = block.join('?&gt;');
	  }
	  
	  text = blocks.join('&lt;?')
	}
	
  /*LANG N : language escape...*/

  /*LANG N : language escape...*/
	
   return text.trim();
	
}

} // end of minimalHTML.converter