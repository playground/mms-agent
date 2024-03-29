#! /usr/bin/env node
import { createWriteStream, existsSync, readFileSync, unlinkSync } from 'fs';
import https from 'https';
import zipFile from 'is-zip-file';
import { pipeline } from 'stream';

const cp = require('child_process'),
exec = cp.exec;

// A simple Horizon sample edge service that shows how to use a Model Management System (MMS) file with your service.
// In this case we use a MMS file as a config file for this service that can be updated dynamically. The service has a default
// copy of the config file built into the docker image. Once the service starts up it periodically checks for a new version of
// the config file using the local MMS API (aka ESS) that the Horizon agent provides to services. If an updated config file is
// found, it is loaded into the service and the config parameters applied (in this case who to say hello to).

// Of course, MMS can also hold and deliver inference models, which can be used by services in a similar way.

let pEnv = process.env;

export class Mms {
  // The type and name of the MMS file we are using
  objectType = pEnv.MMS_OBJECT_TYPE;
  objectId;
  updateFilename = pEnv.UPDATE_FILE_NAME;
  // ${HZN_ESS_AUTH} is mounted to this container by the Horizon agent and is a json file with the credentials for authenticating to ESS.
  // ESS (Edge Sync Service) is a proxy to MMS that runs in the Horizon agent.
  essAuth;
  user;
  password;
  auth;
  // ${HZN_ESS_CERT} is mounted to this container by the Horizon agent and the cert clients use to verify the identity of ESS.
  cert =  '--cacert ';
  socket = '--unix-socket ';
  baseUrl = 'https://localhost/api/v1/objects';
  sharedVolume = pEnv.MMS_VOLUME_MOUNT || '/mms-shared';
  tempFile;
  essObjectList;
  essObjectGet;
  essObjectReceived;
  timer;
  timeout = 10000;

  constructor() {
    this.cert += pEnv.HZN_ESS_CERT ? pEnv.HZN_ESS_CERT : '/ess-auth/cert.pem';
    this.socket += pEnv.HZN_ESS_API_ADDRESS ? pEnv.HZN_ESS_API_ADDRESS : '/var/run/horizon/essapi.sock';
    this.essAuth = require(`${pEnv.HZN_ESS_AUTH}`);
    this.user = this.essAuth.id;
    this.password = this.essAuth.token;
    this.auth = `${this.user}:${this.password}`;
    // this.tempFile = `.${this.objectId}`; 

    this.essObjectList = `curl -sSL -u ${this.auth} ${this.cert} ${this.socket} ${this.baseUrl}/${this.objectType}`;
    // this.essObjectGet = `curl -sSL -u ${this.auth} ${this.cert} ${this.socket} ${this.baseUrl}/${this.objectType}/${this.objectType}/data -o ${this.sharedVolume}/${this.tempFile}`;
    // this.essObjectReceived = `curl -sSL -X PUT -u ${this.auth} ${this.cert} ${this.socket} ${this.baseUrl}/${this.objectType}/${this.objectId}/received`;
    this.monitor(this.timeout);
  }

  monitor(ms) {
    this.timer = setInterval(() => {
      this.process();
    }, ms)
  }

  resetTimer() {
    clearInterval(this.timer);
    this.monitor(this.timeout);  
  }

  process() {
    clearInterval(this.timer);
    // See if there is a new version of the config.json file

    try {
      console.log('checking...')
      exec(this.essObjectList, {maxBuffer: 1024 * 2000}, (err, stdout, stderr) => {
        if(!err) {
          console.log(stdout)
          console.log(`done curling`);
          if(stdout && stdout.length > 0) {
            let config = JSON.parse(stdout);
            // console.log(config[this.objectType]);
            if(config.length > 0 && !config[0].deleted) {
              this.objectId = config[0].objectID;
              this.tempFile = `.${this.objectId}`; 
              this.essObjectGet = `curl -sSL -u ${this.auth} ${this.cert} ${this.socket} ${this.baseUrl}/${this.objectType}/${this.objectId}/data -o ${this.sharedVolume}/${this.tempFile}`;
              this.essObjectReceived = `curl -sSL -X PUT -u ${this.auth} ${this.cert} ${this.socket} ${this.baseUrl}/${this.objectType}/${this.objectId}/received`;                
              exec(this.essObjectGet, {maxBuffer: 1024 * 2000}, (err, stdout, stderr) => {
                if(!err) {
                  console.log('ESS object file copy was successful.');
                  exec(this.essObjectReceived, {maxBuffer: 1024 * 2000}, async (err, stdout, stderr) => {
                    if(!err) {
                      console.log('ESS object received command was successful.');
                      if(zipFile.isZipSync(`${this.sharedVolume}/${this.tempFile}`)) {                    
                        console.log('zipped file has arrived...')
                        await this.moveFileToShare(`${this.sharedVolume}/${this.tempFile}`, `${this.sharedVolume}/model.zip`);  //hardcode model.zip for now, need to find a way to pass in filename
                         this.resetTimer();
                      } else {                                                                            
                        console.log('json')
                        let json = JSON.parse(readFileSync(`${this.sharedVolume}/${this.tempFile}`).toString());                                                               
                        if(json) {
                          console.log(json.hello)
                          await this.moveFileToShare(`${this.sharedVolume}/${this.tempFile}`, `${this.sharedVolume}/${this.updateFilename}`);
                          //await this.writeFileToShare(json, `${this.sharedVolume}/${this.tempFile}`, `${this.sharedVolume}/${this.updateFilename}`);
                          this.resetTimer();
                        } else {
                          console.log('Invalid payload')
                          this.resetTimer();
                        }
                      }   
                    } else {
                      console.log("ERROR ", err);
                      this.resetTimer();
                    }
                  });      
                } else {
                  console.log("ERROR ", err);
                  this.resetTimer();
                }
              });
            } else {
              this.resetTimer();
            }
          } else {
            this.resetTimer();
          }
        } else {
          console.log('ERROR ', err);
          this.resetTimer();
        }
      });
    } catch(e) {
      console.log(e);
      this.resetTimer();
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  writeFileToShare(url, src, dest) {
    return new Promise((resolve, reject) => {
      try {
        let writableStream = createWriteStream(src);                                                           
        const startTime = Date.now();
    
        writableStream.on('close', async () => {
          let cnt = 0;
          const endTime = Date.now();
          do {  // wait maximum 3 seconds for file to close
            this.sleep(1000);
          } while(!existsSync(src) && cnt++ < 3);
          if(existsSync(src)) {
            await this.moveFileToShare(src, dest);
          }
          const res = `Time took to download file: ${endTime - startTime}`
          console.log(res)
          resolve(res);
        });
        https.get(url, (resp) => {
          pipeline(resp, writableStream, (err) => {
            if(!err) {
            } else {
              console.log(err);
              unlinkSync(this.tempFile)
            }
          })
        });  
      } catch(e) {
        console.log(e);
        resolve(e);
      }
    })
  }

  moveFileToShare(src, dest) {
    return new Promise((resolve, reject) => {
      try {
        let arg = `mv ${src} ${dest}`
        console.log(arg);
        const startTime = Date.now();
        exec(arg, {maxBuffer: 1024 * 2000}, (err, stdout, stderr) => {
          if(!err) {
            console.log(`done moving update files to shared volume`);
          } else {
            console.log('failed to move update file to shared volume', err);
          }
          const endTime = Date.now();
          const res = `Time took to write file: ${endTime - startTime}`
          console.log(res)
          resolve(res);
        });       
      } catch(e) {
        console.log(e)
        resolve(e);
      }
    });
  }

  fetchUpdateFile(url) {
    let arg = `mv ${this.sharedVolume}/${this.tempFile} ${this.sharedVolume}/${this.updateFilename}`
    console.log(arg);
    exec(arg, {maxBuffer: 1024 * 2000}, (err, stdout, stderr) => {
      if(!err) {
        console.log(`done moving update files to shared volume`);
      } else {
        console.log('failed to move update file to shared volume', err);
      }
    });     
  }
}

new Mms();
