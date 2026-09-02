const http = require('http');

async function testOldToken() {
  const oldToken = 'd21955ff3d058cfc9f03112c965f1a1a9ac055b8e69fe74d62775d492085d769';
  const data = JSON.stringify({ token: oldToken, password: 'testpass123' });
  
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
          console.log('Old token after resend result:', result);
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

testOldToken().catch(console.error);