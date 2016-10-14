#!/usr/bin/env node

const program = require('commander');
const colors  = require('colors');
const util    = require('util');
const fs      = require('fs');

const ethrex  = require('./core.js');

program
  .version('1.0.0')
  .option('-w, --watch []', 'Watch and display changes', () => true, false)
  .option('-n, --network [name]', 'Network to use', /^(morden|homestead)$/i, 'homestead')
  .option('-d, --disable-colors []', 'Disable colored output', () => true, false)
  .option('-j, --json []', 'Output in machine-readable JSON', () => true, false)
  .option('-v, --verbose []', 'Display verbose debugging output', () => true, false)

const _client = () => ethrex({network: program.network, verbose: program.verbose});
const ok  = (res) => { if (program.json) console.log(JSON.stringify(res)); else console.dir(res, {depth: null, colors: !program.disableColors}); };
const err = (msg) => { if (program.json) console.log(JSON.stringify(msg)); else console.log(((s) => program.disableColors ? s : s.red)('Error: ' + msg)); };

const main = (ty, id) => {
  const client = _client();
  const func   = client[ty](id)[program.watch ? 'live' : 'get'];
  func(ok, program.watch ? () => {} : err, () => {});
};

const unique = (ty, val) => {
  switch(ty) {
    case 'block':
    case 'transaction':
      return val.hash;
    case 'account':
      return val.address;
    case 'node':
      return val.host;
  };
}

program.command('net').description('Display network information').action(() => main('network'));

program.command('blk <id>').description('Display information about a block').action((id) => main('block', id));

program.command('txn <id>').description('Display information about a transaction').action((id) => main('transaction', id));

program.command('acc <id>').description('Display information about an account or contract').action((id) => main('account', id));

program.command('node <id>').description('Display information about a node').action((id) => main('node', id));

program.command('search <query>').description('Search across blocks, transactions, accounts, contracts, and nodes').action((query) => {
  const client = _client();

  callback = (res) => {
    if (program.json) console.log(JSON.stringify(res))
    else {
      res.forEach((match) => {
        if (program.disableColors) {
          console.log(match.type + ' ' + unique(match.type, match.value) + ' matched ' + match.field + ': ' + match.value[match.field]);
        } else {
          console.log((match.type.red) + ' ' + unique(match.type, match.value).blue + ' matched ' + (match.field.green) + ': ' + (match.value[match.field].yellow));
        };
      });
      if (res.length === 0) {
        console.log('No results found!');
      }
    };
  }
  client.search().get(query, callback);
});

program.command('trace <hash>')
  .description('Trace a transaction')
  .action((hash) => {
    if (!program.json) console.log('Tracing transaction; this may take several seconds.');
    _client().transaction(hash).trace(ok, err);
  });

program.command('verify <address> <name> <version> <filename>')
  .option('-u, --url [url]', 'URL to associate with the contract (optional)')
  .option('-o, --disable-optimizations', 'Compile with optimizations disabled', false)
  .description('Verify the source code of a contract')
  .action((address, name, version, filename) => {
    if (!program.json) console.log('Verifying contract; this may take 5-10 seconds.');
    const source = fs.readFileSync(filename);
    _client().account(address).verify(name, source, version, !program.disableOptimizations, program.url, ok, err);
  });

program.command('call <address> <method> [args...]').description('Call a function on a contract (pass args JSON-encoded)')
  .action((address, method, args) => {
    _client().account(address).call(method, args.map(JSON.parse), ok, err);
  });

program.command('*').action(() => program.help());

program.parse(process.argv);

if (program.args.length === 0) program.help();
