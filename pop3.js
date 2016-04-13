var fs = require('fs');
var net = require('net');
var uuid = require('uuid');
var md5 = require('md5-file');
var md5s = require('MD5');
var process = require('process');
var users = require("./users.json");
var mailDir = __dirname + "/mail/";

console.log() // Pretty-print
// Default configuration
try {
  fs.mkdirSync(mailDir);
  console.log("Messages directory created in : '" + mailDir + "'");
}
catch (e) {
  console.log("Messages directory already exists in : '" + mailDir + "'");
}

function statMails(dir, deleted) {
  res = [];
  var mailFiles = fs.readdirSync(dir).sort(function(a,b) { return a-b });
  res.push(mailFiles.length - deleted.length);
  var totalSize = 0;
  for (var i=0; i<mailFiles.length; i++)
    if (deleted.indexOf(mailFiles[i]) == -1) totalSize += fs.statSync(dir + mailFiles[i])["size"];
  res.push(totalSize);
  return res;
}

function listMails(dir, deleted) {
  res = [];
  var mailFiles = fs.readdirSync(dir).sort(function(a,b) { return a-b });
  for (var i=0; i<mailFiles.length; i++)
    if (deleted.indexOf(mailFiles[i]) == -1) res.push(mailFiles[i] + " " + fs.statSync(dir + mailFiles[i])["size"]);

  return res;
}

function updateMails(dir, deleted) {
  for (var i=0; i < deleted.length; i++)
    fs.unlinkSync(dir + deleted[i])

  var mailFiles = fs.readdirSync(dir).sort(function(a,b) { return a-b });
  for (var i=1; i <= mailFiles.length; i++) {
    if (mailFiles[i-1] != i) fs.renameSync(dir + mailFiles[i-1], dir + i);
  }

  return 0;
}

function uidlMails(dir, deleted) {
  res = [];
  var mailFiles = fs.readdirSync(dir).sort(function(a,b) { return a-b });
  for (var i=0; i<mailFiles.length; i++)
    if (deleted.indexOf(mailFiles[i]) == -1) res.push(mailFiles[i] + " " + md5(dir + mailFiles[i]));

  return res;
}

net.createServer(function (socket) {
  socket.id = uuid.v4();
  socket.greet = "<"+ process.pid + "." + Math.floor(Date.now() / 1000) + "@pop3server>";
  socket.write("+OK POP Server READY " + socket.greet + "\r\n");
  socket.state = "AUTHORIZATION";

  socket.deletedMails = [];

  socket.on('data', function(data) {
    data = (""+data).replace("\n", "").replace("\r", "");
    console.log("["+socket.id+"] `"+data+"`");
    datas = data.split(" ");
    command = datas[0];
    if (socket.state == "AUTHORIZATION") {
      switch (command) {
        case "USER":
          try {
            fs.readdirSync(mailDir + datas[1]);
            if (users[datas[1]]) {
              if (users[datas[1]].locked) {
                socket.write("-ERR user \"" + datas[1] + "\" locked\r\n");
              } else {
                socket.user = datas[1];
                socket.write("+OK password required for user \"" + datas[1] + "\"\r\n");
              }
            } else throw err;
          } catch (e) {
            socket.write("-ERR user \"" + datas[1] + "\" not found\r\n");
          }
          break;
        case "PASS":
          if (socket.user) {
            var pass = data.replace(datas[0]+" ", "");
            if (users[socket.user].pass === pass) {
              socket.mailDir = mailDir + socket.user + "/";
              socket.state = "TRANSACTION";
              users[socket.user].locked = true;
              socket.write("+OK maildrop ready and locked for \"" + socket.user + "\"\r\n");
            } else {
              socket.user = undefined;
              socket.write("-ERR invalid password\r\n");
            }
          } else {
            socket.write("-ERR you must use USER first\r\n");
          }
          break;
        case "APOP":
          console.log(users);
          try {
            if (!(datas[1] && datas[2])) throw err;
            fs.readdirSync(mailDir + datas[1]);
            if (users[datas[1]]) {
              if (users[datas[1]].locked) {
                socket.write("-ERR user \"" + datas[1] + "\" locked\r\n");
              } else {
                secretHashed = md5s(socket.greet + users[datas[1]].secret);
                if (secretHashed == datas[2]) {
                  socket.user = datas[1];
                  socket.mailDir = mailDir + socket.user + "/";
                  socket.state = "TRANSACTION";
                  users[socket.user].locked = true;
                  socket.write("+OK maildrop ready and locked for \"" + socket.user + "\"\r\n");
                } else {
                  socket.write("-ERR permission denied\r\n");
                }
              }
            } else throw err;
          } catch (e) {
            socket.write("-ERR user \"" + datas[1] + "\" not found\r\n");
          }
          break;
        case "QUIT":
          socket.write("+OK POP server signing off\r\n");
          socket.destroy();
          break;
        default:
          socket.write("-ERR unknown command\r\n");
          break;
      }
    } else if (socket.state == "TRANSACTION") {
      switch (command) {
        case "STAT":
          statRes = statMails(socket.mailDir, socket.deletedMails);
          socket.write("+OK " + statRes[0] + " " + statRes[1] + "\r\n");
          break;
        case "LIST":
          if (datas[1]) {
            try {
              if (socket.deletedMails.indexOf(datas[1]) != -1) throw err;
              var size = fs.statSync(socket.mailDir + datas[1])["size"];
              socket.write("+OK " + datas[1] + " " + size + "\r\n");
            } catch (e) {
              var mailFiles = fs.readdirSync(socket.mailDir);
              var nbMails = mailFiles.length - socket.deletedMails.length;
              if (nbMails <= 1) socket.write("-ERR no such message, only " + nbMails + " message in maildrop\r\n");
              else socket.write("-ERR no such message, only " + nbMails + " messages in maildrop\r\n");
            }
          } else {
            listRes = listMails(socket.mailDir, socket.deletedMails);
            socket.write("+OK\r\n");
            for (var i=0; i<listRes.length; i++)
              socket.write(listRes[i] + "\r\n");
            socket.write(".\r\n");
          }
          break;
        case "RETR":
          try {
            if (socket.deletedMails.indexOf(datas[1]) != -1) throw err;
            var message = fs.readFileSync(socket.mailDir + datas[1]);
            socket.write("+OK " + message.length + " octets\r\n");
            socket.write(message);
            socket.write(".\r\n");
          } catch (e) {
            socket.write("-ERR no such message\r\n");
          }
          break;
        case "DELE":
          try {
            if (socket.deletedMails.indexOf(datas[1]) != -1) throw err;
            var file = fs.statSync(socket.mailDir + datas[1]);
            socket.deletedMails.push(datas[1]);
            socket.write("+OK message deleted\r\n");
          } catch(e) {
            socket.write("-ERR no such message\r\n");
          }
          break;
        case "NOOP":
          socket.write("+OK");
          break;
        case "RSET":
          socket.deletedMails = [];
          statRes = statMails(socket.mailDir, socket.deletedMails);
          socket.write("+OK maildrop has " + statRes[0] + " messages (" +  statRes[1] + " octets)\r\n");
          break;
        case "QUIT":
          socket.write("+OK POP server signing off \r\n");
          socket.state = "UPDATE";
          users[socket.user].locked = false;
          updateMails(socket.mailDir, socket.deletedMails);
          socket.destroy();
          break;
        case "TOP":
          try {
            if (socket.deletedMails.indexOf(datas[1]) != -1) throw err;
            if (!(datas[1] && datas[2] && datas[2] > 0)) throw err;
            var topLines = datas[2];
            var message = fs.readFileSync(socket.mailDir + datas[1])+"";
            var messageSplit = message.split("\n\                                                                                                     n");
            var messageHeaders = messageSplit[0]+"\n\n";
            messageSplit.shift();
            var messageBody = messageSplit.join("\n\n").split("\n");
            var messageTopped = "";
            if (topLines >= messageBody.length) messageTopped = messageBody.join("\n");
            else for (i=0; i<topLines; i++) messageTopped += messageBody[i]+"\n";

            socket.write("+OK\r\n");
            socket.write(messageHeaders);
            socket.write(messageTopped);
            socket.write(".\r\n");
          } catch (e) {
            console.log(e);
            socket.write("-ERR no such message\r\n");
          }
          break;
        case "UIDL":
          if (datas[1]) {
            try {
              if (socket.deletedMails.indexOf(datas[1]) != -1) throw err;
              fs.readFileSync(socket.mailDir + datas[1]);
              socket.write("+OK " + datas[1] + " " + md5(socket.mailDir + datas[1]) + "\r\n");
            } catch (e) {
              var mailFiles = fs.readdirSync(socket.mailDir);
              var nbMails = mailFiles.length - socket.deletedMails.length;
              if (nbMails <= 1) socket.write("-ERR no such message, only " + nbMails + " message in maildrop\r\n");
              else socket.write("-ERR no such message, only " + nbMails + " messages in maildrop\r\n");
            }
          } else {
            uidlRes = uidlMails(socket.mailDir, socket.deletedMails);
            socket.write("+OK\r\n");
            for (var i=0; i<uidlRes.length; i++)
              socket.write(uidlRes[i] + "\r\n");
            socket.write(".\r\n");
          }
          break;
        default:
          socket.write("-ERR unknown command\r\n");
          break;
      }
    }
  });
}).listen(110);

console.log("POP3 Server running on port 110\n");
