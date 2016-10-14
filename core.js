const inBrowser = typeof window !== 'undefined';

const request   = require('request');
const colors    = require('colors');
const pako      = require('pako');
const websocket = inBrowser ? window.WebSocket : require('websocket').w3cwebsocket;
const assign    = require('object-assign');

const root          = 'api.ethrex.io/v1';

const ethrex = (config) => {

  var ethrex = {};

  ethrex.config = {
    apikey: '',
    network: 'homestead',
    verbose: false,
    reconnect: true,
    socketTimeout: 10000
  };

  assign(ethrex.config, config);

  if (ethrex.config.verbose) {
    ethrex.log = (level, msg) => {
      const d = new Date();
      const m = '[' + d.toTimeString().blue + '] (' + level.magenta + ') ' + msg;
      console.log(m);
    };
  } else {
    ethrex.log = () => {};
  }

  ethrex.log('info', 'Ethrex API initialized with network ' + ethrex.config.network);

  ethrex.call = (path, params, callback, error, body) => {
    const fullPath = 'https://' + root + '/' + ethrex.config.network + '/' + path;
    const method   = body ? 'POST' : 'GET';
    ethrex.log('info', method + ' ' + fullPath + ' with params ' + JSON.stringify(params));
    request({method: method, url: fullPath, qs: params, body: body, headers: {'Authorization': 'Bearer ' + ethrex.config.apikey}}, (err, resp, body) => {
      if (err) { error(err); return; }
      if (resp.statusCode == 404) {
        callback(null);
        error(JSON.parse(body).error);
      } else {
        if (resp.statusCode != 200) {
          error(JSON.parse(body).error);
          return;
        }
        callback(JSON.parse(body));
      }
    });
  };

  ethrex.ws = (path, onconnect, onlatency, onmessage) => {
    var ctx = {};
    const fullPath = 'wss://' + root + '/' + ethrex.config.network + '/' + path;
    ctx.check = () => {
      ctx.watcher = setTimeout(ctx.check, 1000);
      if (typeof ctx.ping === 'function') { try { ctx.ping(); } catch(e) {} }
      if (ethrex.config.reconnect && ((Date.now() - ctx.lastPong) > ethrex.config.socketTimeout)) {
        ethrex.log('warn', 'Connection on ' + fullPath + ' timed out, attempting reconnect');
        ctx.send = () => {};
        ctx.ping = () => {};
        try { ctx.sock.close(); } catch(e) {}
        connect();
      };
    };
    const connect = () => {
      ctx.lastPong = Date.now();
      ctx.sock = new websocket(fullPath);
      ctx.sock.binaryType = 'arraybuffer';
      ctx.sock.onopen = () => {
        ethrex.log('info', 'Connection opened on ' + fullPath);
        clearTimeout(ctx.watcher);
        ctx.frame = m => ctx.sock.send(pako.deflate(JSON.stringify(m), {from: 'string'})); 
        ctx.send  = m => ctx.frame({type: 'data', data: m});
        ctx.ping  = () => {
          ctx.lastPing = Date.now();
          ctx.frame({type: 'ping'});
        };
        ctx.sock.onmessage = (m) => {
          const msg = JSON.parse(pako.inflate(m.data, {to: 'string'}));
          switch (msg.type) {
            case 'pong':
              ctx.lastPong = Date.now();  
              ctx.latency  = ctx.lastPong - ctx.lastPing;
              onlatency(ctx.latency);
              break;
            case 'data':
              onmessage(msg.data);
              break;
          };
        };
        ctx.sock.onclose = () => { ethrex.log('info', 'Connection closed on ' + fullPath); };
        ctx.sock.onerror = (err) => { ethrex.log('warn', 'Connection error on ' + fullPath + ': ' + err); };
        onconnect((m) => ctx.send(m), () => { clearTimeout(ctx.watcher); ctx.sock.close(); });
        ctx.watcher = setTimeout(ctx.check, 1000);
      };
    };
    ctx.watcher = setTimeout(ctx.check, 1000);
    connect();
  };

  ethrex.filter = () => {
    return {
      live: (onmessage, onopen, onlatency) => ethrex.ws('live/filter', (send, close) => { onopen(send, close); }, onlatency, onmessage)
    };
  };

  ethrex.network = () => {
    return {
      get: (callback, error) => ethrex.call('network', {}, callback, error),
      live: (onmessage, onopen, onlatency) => ethrex.ws('live/network', (send, close) => { onopen(close); }, onlatency, onmessage)
    };
  };
  ethrex.block = (id) => {
    return {
      get: (callback, error) => ethrex.call('blocks/' + id, {}, callback, error),
      live: (onmessage, onopen) => ethrex.ws('live/blocks', (send, close) => { send(id); onopen(close); }, () => {}, onmessage)
    };
  };
  ethrex.transaction = (id) => {
    return {
      get: (callback, error) => ethrex.call('transactions/' + id, {}, callback, error),
      trace: (callback, error) => ethrex.call('transactions/' + id + '/trace', {}, callback, error),
      live: (onmessage, onopen) => ethrex.ws('live/transactions', (send, close) => { send(id); onopen(close); }, () => {}, onmessage),
    };
  };
  ethrex.account = (id) => {
    return {
      get: (callback, error) => ethrex.call('accounts/' + id, {}, callback, error),
      live: (onmessage, onopen) => ethrex.ws('live/accounts', (send, close) => { send(id); onopen(close); }, () => {}, onmessage),
      verify: (name, source, version, optimize, url, callback, error) => ethrex.call('accounts/' + id + '/verify', {name: name, version: version, optimize: optimize, url: url}, callback, error, source),
      call: (name, args, callback, error) => ethrex.call('accounts/' + id + '/call/' + name, {}, callback, error, JSON.stringify(args))
    };
  };
  ethrex.node = (id) => {
    return {
      get: (callback, error) => ethrex.call('nodes/' + id, {}, callback, error),
      live: (onmessage, onopen) => ethrex.ws('live/nodes', (send, close) => { send(id); onopen(close); }, () => {}, onmessage),
    };
  };
  ethrex.search = () => {
    return {
      get: (query, callback) => {
        var ctx = {};
        ethrex.ws('live/search', (send, close) => { send(query); ctx.close = close; }, () => {}, (msg) => { ctx.close(); callback(msg); });
      },
      live: (onmessage, onopen) => ethrex.ws('live/search', (send, close) => { onopen(send, close); }, () => {}, onmessage)
    };
  };
  ethrex.solc = () => {
    return {
      versions: (callback, error) => ethrex.call('misc/solc/versions', {}, callback, error)
    }
  }

  return ethrex;
};

module.exports = ethrex;
