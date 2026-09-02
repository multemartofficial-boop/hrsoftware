const http = require('http');

async function testInvalidToken() {
  const token = 'invalidtoken123456789';
  
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: `/api/auth/validate-setup-token/${token}`,
    method: 'GET'
  };
  
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(responseData);
          console.log('Invalid token validation result:', result);
          resolve(result);
        } catch (e) {
          console.error('Failed to parse response:', responseData);
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

testInvalidToken().catch(console.error);