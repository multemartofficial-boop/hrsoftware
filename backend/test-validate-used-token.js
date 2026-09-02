const http = require('http');

async function testValidateUsedToken() {
  const token = 'dfab94911d1ff76c844423fa03e889a915cd0dfbed65787ff6228800b390f172';
  
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
          console.log('Used token validation result:', result);
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

testValidateUsedToken().catch(console.error);