// Special env vars needed for NOCK consistency

process.env.TWILIO_ACCOUNT_SID = "test";
process.env.TWILIO_AUTH_TOKEN = "token";
process.env.TWILIO_PHONE_NUMBER = "+test";

require('dotenv').config();
var sendQueued = require("../sendQueued.js");
var expect = require("chai").expect;
var assert = require("chai").assert;
var nock = require('nock');
var moment = require("moment");

var db = require('../db');
var Knex = require('knex');
var knex = Knex.initialize({
  client: 'pg',
  connection: process.env.DATABASE_URL
});


nock.disableNetConnect();
nock('https://api.twilio.com:443').log(console.log);

describe("with 2 valid queued cases (same citation)", function() {
  beforeEach(function(done) {
    knex('cases').del().then(function() {
      knex('cases').insert([turnerData()]).then(function() {
        knex("queued").del().then(function() {
          db.addQueued({
              citationId: "4928456",
              phone: "+12223334444"
            }, function(err, data) {
            db.addQueued({
              citationId: "4928456",
              phone: "+12223334444"
            }, function(err, data) {
              done(err);
            });
          });
        });
      });
    });
  });

  it("sends the correct info to Twilio and updates the queued to sent", function(done) {
    var number = "+12223334444";
    var message1 = "(1/2) Hello from the Alaska State Court System.";
    var message2 = "(2/2) We found a case for Frederick Turner scheduled on Fri, Mar 27th at 1:00 PM, at CNVCRT. Would you like a courtesy reminder the day before? (reply YES or NO)";

    nock('https://api.twilio.com:443')
        .post('/2010-04-01/Accounts/test/Messages.json', "To=" + encodeURIComponent(number) + "&From=%2Btest&Body=" + encodeURIComponent(message1))
        .reply(200, {"status":200}, { 'access-control-allow-credentials': 'true'});

    nock('https://api.twilio.com:443')
        .post('/2010-04-01/Accounts/test/Messages.json', "To=" + encodeURIComponent(number) + "&From=%2Btest&Body=" + encodeURIComponent(message2))
        .reply(200, {"status":200}, { 'access-control-allow-credentials': 'true'});

    nock('https://api.twilio.com:443')
        .post('/2010-04-01/Accounts/test/Messages.json', "To=" + encodeURIComponent(number) + "&From=%2Btest&Body=" + encodeURIComponent(message1))
        .reply(200, {"status":200}, { 'access-control-allow-credentials': 'true'});

    nock('https://api.twilio.com:443')
        .post('/2010-04-01/Accounts/test/Messages.json', "To=" + encodeURIComponent(number) + "&From=%2Btest&Body=" + encodeURIComponent(message2))
        .reply(200, {"status":200}, { 'access-control-allow-credentials': 'true'});

    sendQueued().then(function(res) {
      knex("queued").select("*").then(function(rows) {
        console.log("Rows: " + JSON.stringify(rows));
        expect(rows[0].sent).to.equal(true);
        expect(rows[0].asked_reminder).to.equal(true);
        expect(rows[0].asked_reminder_at).to.notNull;
        expect(rows[1].sent).to.equal(true);
        expect(rows[1].asked_reminder).to.equal(true);
        expect(rows[1].asked_reminder_at).to.notNull;
        done();
      }).catch(done);
    }, done);
  });
});

describe("with a queued non-existent case", function() {
  beforeEach(function(done) {
    knex('cases').del().then(function() {
      knex('cases').insert([turnerData()]).then(function() {
        knex("queued").del().then(function() {
          db.addQueued({
            citationId: "123",
            phone: "+12223334444"
          }, function(err, data) {
            done(err);
          });
        });
      });
    });
  });

  it("doesn't do anything < QUEUE_TTL days", function(done) {
    sendQueued().then(function(res) {
      knex("queued").select("*").then(function(rows) {
        expect(rows[0].sent).to.equal(false);
        done();
      }).catch(done);
    }, done);
  });

  it("sends a failure sms after QUEUE_TTL days", function(done) {
    var number = "+12223334444";
    var message = "We haven\'t been able to find your court case. You can go to " + process.env.COURT_PUBLIC_URL + " for more information. - Alaska State Court System";

    nock('https://api.twilio.com:443')
      .post('/2010-04-01/Accounts/test/Messages.json', "To=" + encodeURIComponent(number) + "&From=%2Btest&Body=" + encodeURIComponent(message))
      .reply(200, {"status":200}, { 'access-control-allow-credentials': 'true'});


    var oldDate = moment().clone();
    oldDate.subtract(parseInt(process.env.QUEUE_TTL_DAYS) + 2, 'days');
    knex("queued").update({created_at: oldDate.format()}).then(function() {
      sendQueued().then(function(res) {
        knex("queued").select("*").then(function(rows) {
          console.log(JSON.stringify(rows[0]));
          console.log(process.env.QUEUE_TTL_DAYS);
          console.log(oldDate.format());
          console.log(moment().format());
          expect(rows[0].sent).to.equal(true);
          done();
        }).catch(done);
      }, done);
    });
  });
});

function turnerData(v) {
  return { date: '27-MAR-15',
    defendant: 'Frederick Turner',
    room: 'CNVCRT',
    time: '01:00:00 PM',
    citations: '[{"id":"4928456","violation":"40-8-76.1","description":"SAFETY BELT VIOLATION","location":"27 DECAATUR ST"}]',
    id: '677167760f89d6f6ddf7ed19ccb63c15486a0eab' + (v||"")
  };
}
