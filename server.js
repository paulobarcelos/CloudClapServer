var port = parseInt(process.env.PORT) || 5000;
console.log('port ' + port);
var io = require('socket.io').listen(parseInt(process.env.PORT) || 5000);
io.set('log level', 1);
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
	listens: [String],
	reports: [String],
	uuid: { 
		type: String
	}
});
var ClientModel = mongoose.model('Client', ClientSchema);
//ClientModel.remove({}, function(err) {});

var InteractionSchema = new mongoose.Schema({
	created: { 
		type: Date,
		default: Date.now
	},
	type: { 
		type: String
	},
	clientUuid: { 
		type: String
	},
	data: mongoose.Schema.Types.Mixed
});
var InteractionModel = mongoose.model('Interaction', InteractionSchema);
//InteractionModel.remove({}, function(err) {});


var Client = function(uuid, listens, reports) {
	var self = this,
	socket;


	var init = function(){
		listens = listens || [];
		reports = reports || [];

		if(uuid){
			ClientModel.findOne({ uuid : uuid }, function (err, client) {
				if(!err && client ){
					console.log('MONGOOSE: Client with this uuid already exists.', uuid);
					onDBReady(uuid);
				}
				else{
					console.log('MONGOOSE: Client with this uuid does not exist.', uuid);
					generateDBEntry(uuid);
				}
			});
		}
		else {
			console.log('MONGOOSE: No uuid was provided to client.');
			generateDBEntry();
		}
	}
	var generateDBEntry = function (_uuid) {
		_uuid = _uuid || generateUUID();
		var model = new ClientModel({
			uuid: _uuid,
			listens: listens,
			reports: reports
		});
		model.save(function (error, results) {
			if(!error && results){
				console.log('MONGOOSE: New client successfully created.');
				onDBReady(_uuid);
			}
			else onFatalError('Cannot create DB entry.');
		});
	}
	var generateUUID = function(a){
		return a? (a ^ Math.random()* 16 >> a/4).toString(16): ([1e7] + -1e3 + -4e3 + -8e3 +-1e11 ).replace( /[018]/g, generateUUID );
	}

	var onFatalError = function(error) {
		if(socket)socket.emit('fatal error', error );
	}
	var onLogin = function() {
		socket.emit('login', uuid );
	}
	var onDBReady = function (_uuid) {
		uuid = _uuid;
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


	init();
}

var INTERACTION_EVENTS = {
	'clap' : true,
	'wow' : true,
	'booh' : true,
	'question' : true,
	'announcement': true,
	'gift': true
}

var clients = {};
var listeners = {};
var guaranteedReports = {};
var confirmedReportsIds = {};
var GUARANTEED_REPORTS_ID_FACTORY = 1;

io.sockets.on('connection', function (socket) {
	socket.on('identity', function(data) {
		console.log('identity', data);
		var client = clients[data.uuid];
		if(!client) client = new Client(data.uuid, data.listens, data.reports);
		
		client.socket = socket;
		clients[client.uuid] = client;


		for (var i = data.listens.length - 1; i >= 0; i--) {
			var event = data.listens[i];
			if(!listeners[event]) listeners[event] = {};
			listeners[event][client.uuid] = client;
		};

		for (var i = data.reports.length - 1; i >= 0; i--) {
			(function(){
				var event = data.reports[i];
				socket.on(event, function(data){
					if(!data) data = {};
					data.from = client.uuid;

					if(data.to){
						for (var i = data.to.length - 1; i >= 0; i--) {
							reportToSingleListener(data.to[i], event, data);
						};
					}
					else reportToAllListeners(event, data);

					if(INTERACTION_EVENTS[event]) storeInteraction(event, data);
				});
			})();
			
		};
	});

	socket.on('interaction-query', function(query, acknowledgement) {
		queryModel('interaction-query', socket, InteractionModel, query, acknowledgement);
	});
	socket.on('interaction-query-count', function(query, acknowledgement) {
		queryCountModel('interaction-query-count', socket, InteractionModel, query, acknowledgement);
	});
	socket.on('client-query', function(query, acknowledgement) {
		queryModel('interaction-query', socket, ClientModel, query, acknowledgement);
	});
	socket.on('client-query-count', function(query) {
		queryCountModel('client-query-count', socket, ClientModel, query, acknowledgement);
	});

	
});

var clearGuaranteedReports = function(){
	console.log(guaranteedReports, confirmedReportsIds);
	for(var reportId in guaranteedReports){
		var report = guaranteedReports[reportId];
		if(!confirmedReportsIds[reportId]) 
			reportToSingleListener(report.uuid, report.event, report.data);
		delete guaranteedReports[reportId];
	}
	setTimeout(clearGuaranteedReports, 10000);
}
clearGuaranteedReports();

var queryModel = function(event, socket, Model, query, acknowledgement){
	if(!query) query = {};
	Model.find(query, function (err, results) {
		if(!err && results ){
			console.log('MONGOOSE: query success', query);
			socket.emit(event, results)
			if(acknowledgement) acknowledgement(results);
		}
		else{
			console.log('MONGOOSE: query error', query);
		}
	});
}
var queryCountModel = function(event, socket, Model, query, acknowledgement){
	if(!query) query = {};
	InteractionModel.count(query, function (err, count) {
		if(!err ){
			console.log('MONGOOSE: count success', query);
			socket.emit(event, count)
			if(acknowledgement) acknowledgement(count);
		}
		else{
			console.log('MONGOOSE: count error', query);
		}
	});
}
var reportToAllListeners = function(event, data){
	if(!listeners[event]) return;
	for(var uuid in listeners[event]){
		if(!listeners[event][uuid]) continue;
		if(!listeners[event][uuid].socket) continue;
		listeners[event][uuid].socket.emit(event, data);
	}
}
var reportToSingleListener = function(uuid, event, data){
	if(!listeners[event]) return;

	var reportId = GUARANTEED_REPORTS_ID_FACTORY++;
	//var reportTimeout = setTimeout(function(){
		if(!confirmedReportsIds[reportId]){
			guaranteedReports[reportId] = {
				uuid:uuid,
				event:event,
				data:data
			}
		}		
	//}, 3000);
	

	if(!listeners[event][uuid]) return;
	if(!listeners[event][uuid].socket) return;

	listeners[event][uuid].socket.emit(event, data, function(data){
		// if this runs, we are sure the message was received
		console.log('Report delivered to: ', data)
		confirmedReportsIds[reportId] = true;
		//clearTimeout(reportTimeout);
		if(guaranteedReports[reportId]) 
			delete guaranteedReports[reportId];
		
	});
}
var storeInteraction = function(event, data){
	var model = new InteractionModel({
		type: event,
		clientUuid: data.from,
		data: data
	});
	model.save(function (error, results) {
	});
}