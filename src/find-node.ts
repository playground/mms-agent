const cp = require('child_process'),
exec = cp.exec;

let timer;
const argv: string = process.argv.slice(2).toString()
const match = argv.match(/--port=/)
const port = match ? parseInt(argv.replace(match[0], '')) : 3000;

const find = (name) => {
  exec(`ps -ef | grep "${name}"`, {maxBuffer: 1024 * 2000}, (err, stdout, stderr) => {
    if(!err) {
      const lines = stdout.split('\n')
      let found = false;
      lines.forEach((line, i) => {
        if(line.length > 0 && !line.match(/-ef|grep/) && !line.match(/grep node dist\/mms-agent.js/)) {
          if(line.match(/node dist\/mms-agent.js/)) {
            found = true;
          }
        } 
      })
      if(!found) {
        clearInterval(timer);
        console.log(`restarting mms agent here`)
        const child = exec(`node dist/mms-agent.js`, (err, stdout, stderr) => {
        });
        child.stdout.pipe(process.stdout);
        child.on('data', (data) => {
          console.log(data)
        })
      }
      sleep(2000).then(() => {
        setCheckInterval(8000);
      })
    }
  })
}

const exist = (instance) => {
  return instance.cmd === 'node dist/mms-agent.js';
}

const setCheckInterval = (ms) => {
  clearInterval(timer);
  timer = setInterval(() => {
    find('node dist/mms-agent.js');
  }, ms);
};

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

find('node');
