var server = require('./node-router'),
    sys    = require('sys');

var people = [
	{ name: "Bob", age: 47, programmer: false },
	{ name: "Tim", age: 27, programmer: true },
	{ name: "Jack", age: 3, programmer: false}
];

function on_change(id) {
  if(people[id])
    sys.debug("Person " + id + " added:\n" + JSON.stringify(people[id]));
  else
    sys.debug("Person " + id + " removed.");
}

server.resource("people", server.resourceController("people", people, on_change), 'json');
server.listen(8080);
