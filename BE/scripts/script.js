const request = require('request')
const crypto = require('crypto')

const baseurl = "https://api.coindcx.com"

const timeStamp = Math.floor(Date.now());
// To check if the timestamp is correct
console.log(timeStamp);

// Place your API key and secret below. You can generate it from the website.
const key = "baf649b6bf8e963f88707bd51872f2a257a7f40bdff5c8d3";
const secret = "ddc3b7db09549b22b2631d97b04493a5153e1751180bb7948bcf4d6f8a160dea"


const body = {
    "timestamp": timeStamp
}

const payload = new Buffer(JSON.stringify(body)).toString();
const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')

const options = {
    url: baseurl + "/exchange/v1/users/balances",
    headers: {
        'X-AUTH-APIKEY': key,
        'X-AUTH-SIGNATURE': signature
    },
    json: true,
    body: body
}

request.post(options, function(error, response, body) {
    console.log(body);
})