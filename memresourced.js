var server = require('http_server.js');

var people = [
	{ name: "Bob", age: 47, programmer: false },
	{ name: "Tim", age: 27, programmer: true },
	{ name: "Jack", age: 3, programmer: false}
];

function on_change(id) {
	node.debug(id, JSON.stringify(people(id)));
}

function onLoad() {
	server.resource("people", server.resourceController("people", people), on_change);
	server.listen(8080);
}