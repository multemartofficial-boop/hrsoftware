const http = require('http');

async function testNewToken() {
  const newToken = 'd04f7d6ca5e205d0a3aa97e30784dad0d8ee4776b765e543898d87a74f698d39';
  const data = JSON.stringify({ token: newToken, password: 'newpass123' });
  
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/auth/setup-password',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length
    }
  };
  
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          console.log('New token after resend result:', result);
          resolve(result);
        } catch (e) {
          console.error('Failed to parse response:', responseData);
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

testNewToken().catch(console.error);