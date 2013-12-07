if(process.env.NODETIME_ACCOUNT_KEY) {
  require('nodetime').profile({
    accountKey: process.env.NODETIME_ACCOUNT_KEY,
    appName: 'CloudClapServer' // optional
  });
}

var port = parseInt(process.env.PORT) || 5000;
console.log('port ' + port);
var io = require('socket.io').listen(parseInt(process.env.PORT) || 5000);
io.set('log level', 1);
var mongoose = require('mongoose');

var connectMongoose = function(){
	mongoose.connect(process.env.MONGOLAB_URI || process.env.MONGOHQ_URL || 'mongodb://localhost:27017/cloudclap', function (err, res) {
		if (err) {
			console.log ('MONGOOSE: Error connecting: ' + err);
			setTimeout(connectMongoose, 3000);
		} else {
			console.log ('MONGOOSE: Succeeded to connect');
		}
	});
}
connectMongoose();


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


var Client = function(uuid, listens, reports, clientsRegistry, onDBReadyCallback) {
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
		clientsRegistry[uuid] = self;
		if(socket) onLogin();
		if(onDBReadyCallback) onDBReadyCallback(self);
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
var GUARANTEED_REPORT_EVENTS = {
	'announcement': true,
	'gift': true
}
var VOLATILE_EVENTS = {
	'clap': true,
	'wow': true,
	'booh': true
}

var clients = {};
var listeners = {};
var guaranteedReports = {};
var confirmedReportsIds = {};
var GUARANTEED_REPORTS_ID_FACTORY = 1;
var volatileEventsCount = 0;
var volatileEventsPerSecond = 0;

io.sockets.on('connection', function (socket) {
	socket.on('identity', function(indentityData) {
		console.log('identity', indentityData);

		var registerClientEvents = function(){
			for (var i = 0; i < indentityData.listens.length; i++) {
				var event = indentityData.listens[i];
				if(!listeners[event]) listeners[event] = {};
				listeners[event][client.uuid] = client;
			};

			for (var i = 0; i < indentityData.reports.length; i++) {
				(function(event){
					socket.on(event, function(data){

						if(VOLATILE_EVENTS[event]){
							volatileEventsCount ++;
						}

						if(!data) data = {};
						data.from = client.uuid;

						if(data.to){
							for (var i = 0; i <  data.to.length; i++) {
								reportToSingleListener(data.to[i], event, data);
							};
						}
						else reportToAllListeners(event, data);

						if(INTERACTION_EVENTS[event]) storeInteraction(event, data);
					});
				})(indentityData.reports[i]);
				
			};
		}

		var client;
		if(indentityData.uuid){
			client = clients[indentityData.uuid];
		}
		if(client){
			client.socket = socket;
			registerClientEvents();
		}
		else{
			client = new Client(indentityData.uuid, indentityData.listens, indentityData.reports, clients, registerClientEvents);
			client.socket = socket;
		}
		

	});

	socket.on('interaction-query', function(query, acknowledgement) {
		queryModel('interaction-query', socket, InteractionModel, query, acknowledgement);
	});
	socket.on('interaction-query-count', function(query, acknowledgement) {
		queryCountModel('interaction-query-count', socket, InteractionModel, query, acknowledgement);
	});
	socket.on('interaction-query-distinct', function(data, acknowledgement) {
		queryDistinctModel('interaction-query-distinct', socket, InteractionModel, data.field, data.query, acknowledgement);
	});
	socket.on('client-query', function(query, acknowledgement) {
		queryModel('client-query', socket, ClientModel, query, acknowledgement);
	});
	socket.on('client-query-count', function(query) {
		queryCountModel('client-query-count', socket, ClientModel, query, acknowledgement);
	});
	socket.on('client-query-distinct', function(data, acknowledgement) {
		queryDistinctModel('client-query-distinct', socket, ClientModel, data.field, data.query, acknowledgement);
	});

	
});

var measureVolatileEventsSpeed = function(){
	volatileEventsPerSecond = volatileEventsCount;
	volatileEventsCount = 0;
	console.log(volatileEventsPerSecond);
}
setInterval(measureVolatileEventsSpeed, 1000);

var clearGuaranteedReports = function(){
	//console.log(guaranteedReports, confirmedReportsIds);
	for(var reportId in guaranteedReports){
		var report = guaranteedReports[reportId];
		if(confirmedReportsIds[reportId] || report.attempts > 240) {
			delete guaranteedReports[reportId];
		}
		else{
			report.attempts++;
			guaranteedReportToSingleListener(report.uuid, report.event, report.data, reportId)
		}
	}
	setTimeout(clearGuaranteedReports, 30000);
}
clearGuaranteedReports();

var queryModel = function(event, socket, Model, query, acknowledgement){
	if(!query) query = {};
	Model.find(query, function (err, results) {
		if(!err && results ){
			//console.log('MONGOOSE: query success', query);
			socket.emit(event, results)
			if(acknowledgement) acknowledgement(results);
		}
		else{
			//console.log('MONGOOSE: query error', query);
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
var queryDistinctModel = function(event, socket, Model, field, query, acknowledgement){
	if(!query) query = {};
	Model.distinct(field, query, function (err, results) {
		if(!err && results ){
			console.log('MONGOOSE: query distinct success', field, query);
			socket.emit(event, results)
			if(acknowledgement) acknowledgement(results);
		}
		else{
			console.log('MONGOOSE: query distinct error', field, query);
		}
	});
}
var reportToAllListeners = function(event, data){
	if(!listeners[event]) return;
	for(var uuid in listeners[event]){
		reportToSingleListener(uuid, event, data);
	}
}
var reportToSingleListener = function(uuid, event, data){
	if(GUARANTEED_REPORT_EVENTS[event]) return guaranteedReportToSingleListener(uuid, event, data);
	try{
		listeners[event][uuid].socket.emit(event, data);	
	}
	catch(e){
		console.log(e);
	}

	
}
var guaranteedReportToSingleListener = function(uuid, event, data, reportId){
	try{

		reportId = reportId || GUARANTEED_REPORTS_ID_FACTORY++;
		if(confirmedReportsIds[reportId]){
			if(guaranteedReports[reportId]) delete guaranteedReports[reportId];
			return;
		}
		else{
			guaranteedReports[reportId] = {
				uuid:uuid,
				event:event,
				data:data,
				attempts: 0
			}
		}

		listeners[event][uuid].socket.emit(event, data, function(data){
			// if this runs, we are sure the message was received
			confirmedReportsIds[reportId] = true;
			if(guaranteedReports[reportId]) 
				delete guaranteedReports[reportId];
			
		});
	}
	catch(e){
		console.log(e);
	}

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