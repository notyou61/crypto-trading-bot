import fetch from 'node-fetch'; // or native if using Node 18+

const options = {
  method: 'GET',
  headers: {
    Accept: 'application/json',
    'x-chain': 'solana',
    'X-API-KEY': 'a15eb8c70f8643a39b325c26910e5c90'
  }
};

const url = 'https://public-api.birdeye.so/defi/price?address=9NWUanJ4kJZJQiSfDL6bznAFF46QpPKmJ6fadhpMpump';

fetch(url, options)
  .then(res => res.json())
  .then(data => console.log(data))
  .catch(err => console.error('Fetch failed:', err));
