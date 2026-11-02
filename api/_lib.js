// Shared helpers for the PluginForge API. Files starting with "_" are not exposed as routes.
const crypto = require('crypto');
const redisLib = require('./_redis');
const quota = require('./_quota');
const session = require('./_session');
const projects = require('./_projects');
const http = require('./_http');
const rate = require('./_ratelimit');
const { log } = require('./_log');

// 16 random characters, every character equally likely
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newId() {
  let id = '';
  while (id.length < 16) {
    for (const b of crypto.randomBytes(32)) {
      if (b < 252 && id.length < 16) id += ID_CHARS[b % 36];
    }
  }
  return id;
}

module.exports = { ...redisLib, ...quota, ...session, ...projects, ...http, ...rate, log, newId };
