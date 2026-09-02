# Backend Setup Instructions

## Prerequisites
- Node.js (v14 or higher)
- MySQL Server (v5.7 or higher)
- npm or yarn

## Installation Steps

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the backend directory with the following content:

```env
# Database Configuration
DB_HOST=localhost
DB_NAME=hr_payroll_db
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_PORT=3306

# JWT Secret (CHANGE THIS IN PRODUCTION!)
JWT_SECRET=your_jwt_secret_key_change_this_in_production_make_it_long_and_random

# Server Configuration
PORT=3001
NODE_ENV=development

# CORS Configuration (frontend URL)
FRONTEND_URL=http://localhost:5173
```

### 3. Setup Database
1. Import the schema into your existing database using phpMyAdmin:
   - Open phpMyAdmin
   - Select your database: `u932966089_hr_payroll_db`
   - Go to the Import tab
   - Choose the `schema.sql` file
   - Click "Go" to import

2. Verify the tables were created:
   ```sql
   SHOW TABLES;
   ```

All 15 tables should be created successfully.

### 4. Update Admin Password
The schema includes a default admin user with email `admin@workhr.com`. You should update the password hash:

1. Generate a new bcrypt hash (you can use an online tool or Node.js):
```javascript
const bcrypt = require('bcryptjs');
const hash = bcrypt.hash('your_new_password', 10);
console.log(hash);
```

2. Update the admin user in the database:
```sql
UPDATE users SET password_hash = 'your_new_hash' WHERE email = 'admin@workhr.com';
```

### 5. Start the Server
Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

The server will start on `http://localhost:3001`

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Applications
- `POST /api/applications` - Submit application (public)
- `GET /api/applications` - Get pending applications (admin)
- `GET /api/applications/rejected` - Get rejected applications (admin)
- `GET /api/applications/:id` - Get single application (admin)
- `POST /api/applications/:id/approve` - Approve application (admin)
- `POST /api/applications/:id/reject` - Reject application (admin)

### Workers
- `GET /api/workers` - Get all workers (admin)
- `GET /api/workers/:id` - Get single worker (admin)
- `POST /api/workers` - Create worker (admin)
- `PUT /api/workers/:id` - Update worker (admin)
- `POST /api/workers/:id/reactivate` - Reactivate worker (admin)
- `DELETE /api/workers/:id` - Delete worker (admin)

### Attendance
- `GET /api/attendance` - Get all attendance (admin)
- `GET /api/attendance/my` - Get own attendance (worker)
- `POST /api/attendance` - Add attendance entry (admin)
- `POST /api/attendance/checkin` - Check in (worker)
- `POST /api/attendance/checkout` - Check out (worker)
- `PUT /api/attendance/:id` - Update attendance (admin)
- `DELETE /api/attendance/:id` - Delete attendance (admin)
- `GET /api/attendance/active/shifts` - Get active shifts (admin)

### Payroll
- `GET /api/payroll` - Get all payroll records (admin)
- `POST /api/payroll/preview` - Preview payroll calculation (admin)
- `POST /api/payroll` - Generate payroll (admin)
- `PATCH /api/payroll/:id/status` - Update payroll status (admin)
- `DELETE /api/payroll/:id` - Delete payroll (admin)
- `GET /api/payroll/stats/summary` - Get payroll statistics (admin)

### Locations
- `GET /api/locations` - Get all locations (public)
- `POST /api/locations` - Create location (admin)
- `PUT /api/locations/:id` - Update location (admin)
- `DELETE /api/locations/:id` - Delete location (admin)
- `GET /api/locations/:name/workers-count` - Get workers count by location (admin)

### Buyer Income
- `GET /api/buyer-income` - Get all buyer income (admin)
- `POST /api/buyer-income` - Create buyer income (admin)
- `PUT /api/buyer-income/:id` - Update buyer income (admin)
- `DELETE /api/buyer-income/:id` - Delete buyer income (admin)
- `GET /api/buyer-income/buyers/list` - Get unique buyer names (admin)

### Other Costs
- `GET /api/other-costs` - Get all other costs (admin)
- `POST /api/other-costs` - Create other cost (admin)
- `PUT /api/other-costs/:id` - Update other cost (admin)
- `DELETE /api/other-costs/:id` - Delete other cost (admin)

### Settings
- `GET /api/settings` - Get settings (admin)
- `PUT /api/settings` - Update settings (admin)

### Reports
- `GET /api/reports/dashboard` - Get dashboard statistics (admin)
- `GET /api/reports/weekly` - Get weekly report (admin)
- `GET /api/reports/by-location` - Get location-based report (admin)
- `GET /api/reports/payroll-chart` - Get payroll chart data (admin)
- `GET /api/reports/deductions` - Get deductions data (admin)

### Notifications
- `GET /api/notifications` - Get all notifications (admin)
- `GET /api/notifications/expiry` - Get expiry notices (admin)
- `GET /api/notifications/activity` - Get activity log (admin)
- `POST /api/notifications` - Create notification (admin)
- `DELETE /api/notifications/:id` - Delete notification (admin)

## File Uploads
Uploaded files are stored in the `backend/uploads/documents/` directory and served via `/uploads/` static route.

## Security Notes
1. Change the default JWT_SECRET in production
2. Update the default admin password
3. Use strong database passwords
4. Enable HTTPS in production
5. Implement rate limiting for production
6. Review and adjust CORS settings for production

## Troubleshooting

### Database Connection Issues
- Verify MySQL is running
- Check database credentials in .env
- Ensure the database exists

### File Upload Issues
- Ensure uploads directory exists and is writable
- Check file size limits in multer configuration
- Verify file types are allowed

### Authentication Issues
- Verify JWT_SECRET is set
- Check token expiration (24 hours)
- Ensure user exists in database
