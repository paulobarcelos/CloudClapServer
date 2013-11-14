var io = require('socket.io').listen(8080);

function generateUUID(a){
	return a? (a ^ Math.random()* 16 >> a/4).toString(16): ([1e7] + -1e3 + -4e3 + -8e3 +-1e11 ).replace( /[018]/g, generateUUID );
}

var users = [];
var players = [];
var User = function(id, players) {
	var self = this,
	socket;

	id = id || generateUUID();
	
	var clap = function () {
		emitToPlayers('Execute Clap');
	}
	var wow = function() {
		emitToPlayers('Execute Wow');
	}
	var booh = function() {
		emitToPlayers('Execute Booh');
	}
	var question = function(data) {
		io.sockets.emit('Answer Question', data);
	}

	var emitToPlayers = function (event, data) {
		for (var i = players.length - 1; i >= 0; i--) {
			if(!players[i].socket) continue;
			players[i].socket.emit(event, data);
		};
	}

	var onConnect = function() {
		socket.emit('Login', id );
		socket.on('disconnect', onDisconnect);
		socket.on('Request Clap', clap);
		socket.on('Request Wow', wow);
		socket.on('Resquest Booh', booh);
		socket.on('Ask Question', question);
	}
	var onDisconnect = function() {
		socket = null;
	}

	var getId = function () {
		return id;
	}
	var getSocket = function () {
		return socket;
	}
	var setSocket =  function(value){
		socket = value;
		onConnect();
	}

	Object.defineProperty(self, 'id', {
		get: getId,
	});
	Object.defineProperty(self, 'socket', {
		get: getSocket,
		set: setSocket
	});
}
var Player = function(id) {
	var self = this,
	socket;

	id = id || generateUUID();
	

	var onConnect = function() {
		socket.emit('Login', id );
		socket.on('disconnect', onDisconnect);
	}
	var onDisconnect = function() {
		socket = null;
	}

	var getId = function () {
		return id;
	}
	var getSocket = function () {
		return socket;
	}
	var setSocket =  function(value){
		socket = value;
		onConnect();
	}

	Object.defineProperty(self, 'id', {
		get: getId,
	});
	Object.defineProperty(self, 'socket', {
		get: getSocket,
		set: setSocket
	});
}

io.sockets.on('connection', function (socket) {
	socket.emit('Who are you?');
	socket.on('I am a sound player', function(id) {
		var player = reclaimPlayer(id);
		player.socket = socket;
	});
	socket.on('I am a user', function(id) {
		var user = reclaimUser(id);
		user.socket = socket;
	});
});


var reclaimUser = function(id){
	var user;
	for (var i = 0; i < users.length; i++) {
		if ( (!id && !users[i].id) || (id && users[i].id == id)){
			user = users[i];
			break;
		}
	};
	if(!user){
		user = new User(id, players);
		users.push(user);
	}
	return user;
}

var reclaimPlayer = function(id){
	var player;
	for (var i = 0; i < players.length; i++) {
		if ( (!id && !players[i].id) || (id && players[i].id == id)){
			player = players[i];
			break;
		}
	};
	if(!player){
		player = new Player(id);
		players.push(player);
	}
	return player;
}