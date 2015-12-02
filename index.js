'use strict';

let Connection = require('./lib/connection');
let packet = require('./lib/packet');
let util = require('./lib/util');

module.exports = params => {
    let address = params.address;
    let password = params.password;
    let _connection;
    let nextPacketId;

    return Object.freeze({
        connect: connect,
        command: command
    });

    function connect() {
        let connection = Connection(address);
        return connection.create().then(() => _auth(connection));
    }

    function _auth(connection) {
        let buf = packet.request({
            id: 1,
            type: packet.SERVERDATA_AUTH,
            body: password
        });
        connection.send(buf);
        return Promise.race([
            util.promiseTimeout(3000).then(() => 'timeout'),
            connection.getData(dataHandler)
        ]).then(data => {
            // TODO: data as a single type, not string/object
            if ('timeout' === data) {
                let err = new Error('Auth timeout');
                throw err;
            }
            let res = packet.response(data);
            if (res.id === -1) {
                let err = new Error('Wrong rcon password');
                throw err;
            }
            // Auth successful, but continue after receiving packet index
            return connection.getData(dataHandler).then(() => {
                _init(connection);
            });
        });

        function dataHandler() {
            // Auth response should only return 1 packet
            return false;
        }
    }

    function _init(connection) {
        _connection = connection;
        nextPacketId = 1;
    }

    function _getNextPacketId() {
        return nextPacketId += 1;
    }

    function command(text) {
        return new Promise(resolve => {
            let responseData = new Buffer(0);
            let reqId = _getNextPacketId();
            let req = packet.request({
                id: reqId,
                type: packet.SERVERDATA_EXECCOMMAND,
                body: text
            });
            let ackId = _getNextPacketId();
            let ack = packet.request({
                id: ackId,
                type: packet.SERVERDATA_EXECCOMMAND,
                body: ''
            });
            _connection.send(req);
            _connection.send(ack);
            _connection.getData(dataHandler).then(done);

            function dataHandler(data) {
                let res = packet.response(data);
                if (res.id === ackId) {
                    return false;
                } else if (res.id === reqId) {
                    // More data to come
                    responseData = Buffer.concat([responseData, res.payload], responseData.length + res.payload.length);
                }
                return true;
            }

            function done() {
                let text = packet.convertPayload(responseData);
                resolve(text);
            }
        });
    }
};

