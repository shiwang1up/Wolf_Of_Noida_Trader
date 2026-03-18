require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const request = require('request')
const crypto = require('crypto')

const baseurl = "https://api.coindcx.com"

const timeStamp = Math.floor(Date.now());
// To check if the timestamp is correct
console.log(timeStamp);

// Place your API key and secret below. You can generate it from the website.
const key = process.env.COIN_DCX_USER_KEYS || "";
const secret = process.env.COIN_DCX_USER_SECRET || "";

const body = {
    "timestamp": timeStamp
}

const payload = Buffer.from(JSON.stringify(body)).toString();
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

request.post(options, function (error, response, body) {
    console.log(body);
})