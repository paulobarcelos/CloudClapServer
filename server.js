var io = require('socket.io').listen(parseInt(process.env.PORT) || 5000);
var mongoose = require('mongoose');

mongoose.connect(process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || 'mongodb://localhost:27017/cloudclap', function (err, res) {
	if (err) {
		console.log ('MONGOOSE: Error connecting: ' + err);
	} else {
		console.log ('MONGOOSE: Succeeded to connect');
	}
});

var ClientSchema = new mongoose.Schema({
	created: { 
		type: Date,
		default: Date.now
	},
	type: { 
		type: String
	},
	UUID: { 
		type: String
	}
});
var ClientModel = mongoose.model('Model', ClientSchema);
var InteractionSchema = new mongoose.Schema({
	created: { 
		type: Date,
		default: Date.now
	},
	type: { 
		type: String
	},
	clientUUID: { 
		type: String
	},
	meta: { 
		type: String
	},
});
var InteractionModel = mongoose.model('Interaction', InteractionSchema);

var users = [];
var players = [];
var User = function(id, players) {
	var self = this,
	uuid,
	socket;

	if(id){
		ClientModel.findOne({ UUID : id }, function (err, client) {
			if(!err && client ){
				console.log('MONGOOSE: Client with this uuid already exists.', id);
				onDBReady(id);
			}
			else{
				console.log('MONGOOSE: Client with this uuid does not exist.', id);
				generateDBEntry(id);
			}
		});
	}
	else {
		console.log('MONGOOSE: No uuid was provided to client.');
		generateDBEntry();
	}

	
	
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
	var generateDBEntry = function (id) {
		id = id || generateUUID();
		var model = new ClientModel({
			UUID: id,
			type: 'User'
		});
		model.save(function (error, results) {
			if(!error && results){
				console.log('MONGOOSE: New client successfully created.', id);
				onDBReady(id);
			}
			else onFatalError('Cannot create DB entry.');
		});
	}
	var onFatalError = function(error) {
		if(socket)socket.emit('Fatal Error', error );
	}
	var onLogin = function() {
		socket.emit('Login', uuid );
	}
	var onDBReady = function (id) {
		uuid = id;
		if(socket) onLogin();
	}
	var onConnect = function() {		
		socket.on('disconnect', onDisconnect);
		socket.on('Request Clap', clap);
		socket.on('Request Wow', wow);
		socket.on('Resquest Booh', booh);
		socket.on('Ask Question', question);
		if(uuid) onLogin();
	}
	var onDisconnect = function() {
		socket = null;
	}

	var getUUID = function () {
		return uuid;
	}
	var getSocket = function () {
		return socket;
	}
	var setSocket =  function(value){
		socket = value;
		onConnect();
	}

	Object.defineProperty(self, 'uuid', {
		get: getUUID,
	});
	Object.defineProperty(self, 'socket', {
		get: getSocket,
		set: setSocket
	});
}
var Player = function(id) {
	var self = this,
	uuid,
	socket;

	if(id){
		ClientModel.findOne({ UUID : id }, function (err, client) {
			if(!err && client ){
				console.log('MONGOOSE: Client with this uuid already exists.', id);
				onDBReady(id);
			}
			else{
				console.log('MONGOOSE: Client with this uuid does not exist.', id);
				generateDBEntry(id);
			}
		});
	}
	else {
		console.log('MONGOOSE: No uuid was provided to client.');
		generateDBEntry();
	}

	var generateDBEntry = function (id) {
		id = id || generateUUID();
		var model = new ClientModel({
			UUID: id,
			type: 'Player'
		});
		model.save(function (error, results) {
			if(!error && results){
				console.log('MONGOOSE: New client successfully created.', id);
				onDBReady(id);
			}
			else onFatalError('Cannot create DB entry.');
		});
	}
	var onFatalError = function(error) {
		if(socket)socket.emit('Fatal Error', error );
	}
	var onLogin = function() {
		socket.emit('Login', uuid );
	}
	var onDBReady = function (id) {
		uuid = id;
		if(socket) onLogin();
	}
	var onConnect = function() {
		if(uuid) onLogin();
		socket.on('disconnect', onDisconnect);
	}
	var onDisconnect = function() {
		socket = null;
	}

	var getUUID = function () {
		return uuid;
	}
	var getSocket = function () {
		return socket;
	}
	var setSocket =  function(value){
		socket = value;
		onConnect();
	}

	Object.defineProperty(self, 'uuid', {
		get: getUUID,
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
		if ( (!id && !users[i].uuid) || (id && users[i].uuid == id)){
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
function generateUUID(a){
	return a? (a ^ Math.random()* 16 >> a/4).toString(16): ([1e7] + -1e3 + -4e3 + -8e3 +-1e11 ).replace( /[018]/g, generateUUID );
}
