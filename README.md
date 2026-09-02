# HR & Payroll Management System - Complete Backend Implementation

This document provides comprehensive setup and testing instructions for the complete backend implementation of the HR & Payroll Management System.

## 🎯 What Has Been Built

### Backend (Node.js + Express + MySQL)
- **Complete REST API** with 15+ endpoints covering all admin and worker functionality
- **MySQL Database Schema** with 15 tables covering all entities
- **Authentication System** with JWT tokens and bcrypt password hashing
- **Role-Based Access Control** (Admin vs Worker) with proper middleware
- **File Upload Handling** with multer for registration documents
- **CORS Configuration** for frontend-backend communication
- **Production-ready structure** with proper error handling and connection pooling

### Frontend Integration
- **API Client** with automatic token management and error handling
- **Real Data Wiring** replacing all mock data with real API calls
- **Loading States** and error handling across all pages
- **Backward Compatibility** with existing UI/UX unchanged

## 📋 Database Schema Overview

### Core Tables
1. **users** - Authentication (admin/worker accounts)
2. **workers** - Main worker records with contract details
3. **registration_applications** - Pending applications with full JSON details
4. **attendance** - Check-in/check-out records
5. **payroll** - Generated payroll records
6. **locations** - Work locations
7. **buyer_income** - Client payments
8. **other_costs** - Operating expenses
9. **settings** - System configuration
10. **notifications** - Activity log and expiry alerts

### Related Tables
- **worker_previous_addresses** - Application/worker address history
- **worker_employment_history** - Employment records
- **worker_referees** - Character references
- **worker_qualifications** - Skills and certifications

**Note:** The database name should be `u932966089_hr_payroll_db` for Hostinger shared MySQL. The schema.sql file has been modified to work with existing databases (CREATE DATABASE and USE statements are commented out).

## 🚀 Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- MySQL Server (v5.7 or higher)
- npm or yarn

### Step 1: Backend Setup

#### 1.1 Install Dependencies
```bash
cd backend
npm install
```

#### 1.2 Configure Environment Variables
Create a `.env` file in the backend directory:

```env
# Database Configuration
DB_HOST=localhost
DB_NAME=u932966089_hr_payroll_db
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

#### 1.3 Setup Database
1. Import the schema into your existing database using phpMyAdmin:
   - Open phpMyAdmin
   - Select your database: `u932966089_hr_payroll_db`
   - Go to the Import tab
   - Choose the `backend/schema.sql` file
   - Click "Go" to import

2. Verify the tables were created:
   ```sql
   SHOW TABLES;
   ```

All 15 tables should be created successfully.

#### 1.4 Update Admin Password
The schema includes a default admin user (`admin@workhr.com` / `admin123`). **Update this for production:**

1. Generate a new bcrypt hash:
```javascript
const bcrypt = require('bcryptjs');
const hash = bcrypt.hash('your_new_password', 10);
console.log(hash);
```

2. Update the admin user in the database:
```sql
UPDATE users SET password_hash = 'your_new_hash' WHERE email = 'admin@workhr.com';
```

#### 1.5 Start the Backend Server
```bash
npm run dev
```

The server will start on `http://localhost:3001`

### Step 2: Frontend Setup

#### 2.1 Configure Frontend Environment
Create a `.env` file in the root directory:

```env
# Backend API URL
VITE_API_URL=http://localhost:3001
```

#### 2.2 Start the Frontend
```bash
npm run dev
```

The frontend will start on `http://localhost:5173`

## 🧪 Testing Guide

### 1. Test Authentication Flow

#### Test Admin Login
1. Navigate to `http://localhost:5173`
2. Login with:
   - Email: `admin@workhr.com`
   - Password: `admin123`
3. Should redirect to admin dashboard
4. Verify admin can access all admin pages

#### Test Worker Login
After approving an application (see below):
1. Logout from admin
2. Login with worker credentials (provided during approval)
3. Should redirect to worker dashboard
4. Verify worker can only access their own data

### 2. Test Registration Flow

#### Submit New Application
1. Navigate to registration form (`/register`)
2. Fill out all 5 steps of the form
3. Upload required documents (photo, ID front, proof of address)
4. Submit the form
5. Should see success message with application ID

#### Verify Application in Database
```sql
SELECT * FROM registration_applications WHERE status = 'pending' ORDER BY submitted DESC LIMIT 1;
```

### 3. Test Approval Flow

#### Approve Application
1. Login as admin
2. Navigate to Registration Approvals (`/admin/approvals`)
3. Click on an application to view details
4. Click "Approve"
5. Should see success message with new worker code

#### Verify Worker Creation
```sql
SELECT * FROM workers ORDER BY joined DESC LIMIT 1;
SELECT * FROM users WHERE role = 'worker' ORDER BY created_at DESC LIMIT 1;
```

- Worker should have generated code (e.g., WKR-2026-0147)
- Worker should have expiry date 3 months from now
- User account should be created for the worker

### 4. Test Attendance Flow

#### Worker Check-In
1. Login as worker
2. Click "Check In"
3. Select work location
4. Confirm check-in
5. Should see checked-in status with elapsed time

#### Verify Attendance Record
```sql
SELECT * FROM attendance WHERE worker_id = 'WORKER_CODE' ORDER BY date DESC LIMIT 1;
```

#### Worker Check-Out
1. Click "Check Out" while checked in
2. Should see total hours worked
3. Verify attendance record updated with check-out time

#### Admin Manual Attendance
1. Login as admin
2. Navigate to Attendance (`/admin/attendance`)
3. Click "Add Entry"
4. Fill in worker, date, times, location
5. Should add admin-tagged attendance record

### 5. Test Payroll Flow

#### Generate Payroll
1. Login as admin
2. Navigate to Payrolls (`/admin/payroll`)
3. Click "New Payroll"
4. Select worker and date range
5. Set advance amount if needed
6. View calculation preview
7. Click "Generate payroll"
8. Should see payroll record with calculated amounts

#### Verify Payroll Calculation
```sql
SELECT * FROM payroll WHERE worker_id = 'WORKER_CODE' ORDER BY generated_at DESC LIMIT 1;
```

- Verify hours match attendance in period
- Verify gross = hours × rate (with overtime)
- Verify tax calculated using settings rates
- Verify net = gross - tax - advance

### 6. Test Buyer & Profit/Loss Flow

#### Add Buyer Income
1. Navigate to Buyer & Profit/Loss (`/admin/finance`)
2. Click "Add Buyer Payment"
3. Fill in buyer name, description, amount, date
4. Should see income in table and stats updated

#### Add Other Costs
1. Click "Add Cost"
2. Fill in description, amount, date
3. Should see cost in table and stats updated

#### Verify Profit/Loss Calculation
- Total Received = Sum of buyer income
- Total Paid to Workers = Sum of payroll net pay
- Other Costs = Sum of other costs
- Profit/Loss = Total Received - Total Paid - Other Costs

### 7. Test Reports & Analytics

#### Dashboard Statistics
1. Navigate to Admin Dashboard
2. Verify stat cards show correct totals:
   - Active Workers count
   - Total Payroll Cost
   - Pending Registrations count
   - Workers Expiring Soon count

#### Reports Page
1. Navigate to Reports (`/admin/reports`)
2. Verify weekly breakdown shows correct hours and costs
3. Verify location breakdown shows correct data
4. Verify profit/loss calculations match

### 8. Test Settings & Notifications

#### Update Settings
1. Navigate to Settings (`/admin/settings`)
2. Modify tax rates, overtime settings, etc.
3. Click "Save changes"
4. Verify settings persist and affect calculations

#### Test Expiry Notifications
1. Navigate to Notifications (`/admin/notifications`)
2. Should see workers expiring soon (based on settings)
3. Should see activity log from system actions

## 🔒 Security Considerations

### Production Setup
1. **Change JWT_SECRET** to a long, random string
2. **Update admin password** from default
3. **Use strong database passwords**
4. **Enable HTTPS** in production
5. **Restrict CORS** to production domain only
6. **Implement rate limiting** for API endpoints
7. **Use environment variables** for all sensitive data
8. **Regular database backups**

### API Security
- All protected routes require valid JWT token
- Admin-only routes verify admin role
- Worker routes restrict access to own data only
- Passwords are bcrypt-hashed
- File uploads have size and type restrictions

## 📊 API Endpoints Reference

### Authentication
- `POST /api/auth/login` - User login
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

## 🐛 Troubleshooting

### Database Connection Issues
- Verify MySQL is running: `mysql -u root -p -e "SELECT 1;"`
- Check database credentials in `.env`
- Ensure database exists: `SHOW DATABASES;`

### API Connection Issues
- Verify backend is running on port 3001
- Check frontend `VITE_API_URL` in `.env`
- Test API health: `curl http://localhost:3001/api/health`

### File Upload Issues
- Ensure `uploads/documents/` directory exists
- Check file size limits in multer configuration
- Verify file types are allowed

### Authentication Issues
- Verify JWT_SECRET is set in backend `.env`
- Check token expiration (24 hours)
- Ensure user exists in database
- Verify password hash is correct

### Frontend Issues
- Clear browser cache and localStorage
- Check browser console for errors
- Verify API calls in Network tab
- Ensure CORS is configured correctly

## 📝 Data Migration Notes

If you have existing mock data that needs to be preserved:

1. **Export mock data** from the frontend before migration
2. **Map mock fields** to database schema
3. **Create migration scripts** to insert existing data
4. **Test migration** on development database first
5. **Backup production database** before migration

## 🚀 Deployment Checklist

### Backend
- [ ] Set production environment variables
- [ ] Change JWT_SECRET
- [ ] Update admin password
- [ ] Configure production database
- [ ] Enable HTTPS
- [ ] Set up database backups
- [ ] Configure CORS for production domain
- [ ] Implement rate limiting
- [ ] Set up monitoring/logging

### Frontend
- [ ] Set production API URL
- [ ] Build production bundle
- [ ] Configure production hosting
- [ ] Set up CDN for static assets
- [ ] Enable HTTPS
- [ ] Configure analytics

### Database
- [ ] Create production database
- [ ] Run schema migration
- [ ] Import seed data if needed
- [ ] Set up automated backups
- [ ] Configure replication if needed
- [ ] Set up monitoring

## 📞 Support

For issues or questions:
1. Check this documentation first
2. Review API endpoint reference
3. Check database schema in `backend/schema.sql`
4. Review error messages in browser console
5. Test with provided test cases

## ✅ Success Criteria

The implementation is complete when:
- ✅ All admin functions work with real database
- ✅ All worker functions work with real database
- ✅ Registration creates proper database records
- ✅ Approval creates worker with unique code
- ✅ Attendance tracking works end-to-end
- ✅ Payroll calculations are accurate
- ✅ Reports show real data
- ✅ Settings persist and affect calculations
- ✅ File uploads work correctly
- ✅ Authentication and authorization work properly
- ✅ Frontend displays real data without errors
