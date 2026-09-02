const FormData = require('form-data');
const http = require('http');

async function testRegistration() {
  const form = new FormData();
  
  // Basic fields
  form.append('title', 'Mr');
  form.append('surname', 'TestWorker');
  form.append('forename', 'John');
  form.append('dob', '1990-01-01');
  form.append('birthSurname', '');
  form.append('nameChangeDate', '');
  form.append('mobile', '+44 7700 900001');
  form.append('email', 'testworker2@example.com');
  form.append('addr1', '123 Test Street');
  form.append('addr2', '');
  form.append('addr3', '');
  form.append('town', 'London');
  form.append('county', 'London');
  form.append('postcode', 'E1 4TP');
  form.append('country', 'United Kingdom');
  form.append('addressFrom', '2020-01-01');
  form.append('birthPlace', 'London');
  form.append('nationality', 'British');
  form.append('ni', 'QQ 12 34 56 C');
  form.append('rtw', 'Yes');
  form.append('kinForename', 'Jane');
  form.append('kinSurname', 'Test');
  form.append('kinPhone', '+44 7700 900002');
  form.append('kinAddr1', '456 Kin Street');
  form.append('kinAddr2', '');
  form.append('kinAddr3', '');
  form.append('kinTown', 'London');
  form.append('kinCounty', 'London');
  form.append('kinPostcode', 'E1 5TP');
  form.append('kinCountry', 'United Kingdom');
  form.append('hasVisa', 'No');
  form.append('visaType', '');
  form.append('visaExpiry', '');
  form.append('bankName', 'Test Bank');
  form.append('accountHolder', 'John TestWorker');
  form.append('sortAccount', '12-34-56 12345678');
  form.append('medical', '');
  form.append('dietary', '');
  form.append('workedBefore', 'No');
  form.append('beforeFrom', '');
  form.append('beforeTo', '');
  form.append('beforeReason', '');
  form.append('availability', 'Full-time');
  form.append('rate', '15.00');
  
  // JSON arrays
  form.append('prevAddresses', '[]');
  form.append('employers', '[]');
  form.append('referees', JSON.stringify([{
    name: 'Test Referee',
    phone: '+44 7700 900003',
    email: 'referee2@example.com',
    address: '789 Referee Street, London',
    years: '5',
    relationship: 'Professional'
  }]));
  form.append('skills', '[]');
  form.append('prefLocations', JSON.stringify(['Camden Site']));
  
  const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/applications',
    method: 'POST',
    headers: form.getHeaders()
  };
  
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log('Registration result:', result);
          resolve(result);
        } catch (e) {
          console.error('Failed to parse response:', data);
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    form.pipe(req);
  });
}

testRegistration().catch(console.error);