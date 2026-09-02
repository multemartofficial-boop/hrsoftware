-- HR & Payroll Management System Database Schema
-- MySQL Database Schema

-- Create database (commented out for import into existing database)
-- CREATE DATABASE IF NOT EXISTS hr_payroll_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE hr_payroll_db;

-- Users table for authentication
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('admin', 'worker') NOT NULL,
    worker_id VARCHAR(50) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_worker_id (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Workers table
CREATE TABLE workers (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    role VARCHAR(255) NOT NULL,
    rate DECIMAL(10, 2) NOT NULL,
    joined DATE NOT NULL,
    expiry DATE NOT NULL,
    on_leave BOOLEAN DEFAULT FALSE,
    address TEXT NULL,
    nid VARCHAR(50) NULL,
    status ENUM('active', 'expired') DEFAULT 'active',
    INDEX idx_email (email),
    INDEX idx_location (location),
    INDEX idx_status (status),
    INDEX idx_expiry (expiry)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registration applications table
CREATE TABLE registration_applications (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    submitted TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    phone VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    address TEXT NOT NULL,
    nid VARCHAR(50) NOT NULL,
    applied_for VARCHAR(255) NOT NULL,
    location VARCHAR(255) NOT NULL,
    rate DECIMAL(10, 2) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    details JSON NULL,
    rejected_on TIMESTAMP NULL,
    INDEX idx_status (status),
    INDEX idx_submitted (submitted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Worker previous addresses (related table)
CREATE TABLE worker_previous_addresses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    application_id VARCHAR(50) NULL,
    worker_id VARCHAR(50) NULL,
    line1 VARCHAR(255) NOT NULL,
    line2 VARCHAR(255) NULL,
    line3 VARCHAR(255) NULL,
    town VARCHAR(255) NOT NULL,
    county VARCHAR(255) NOT NULL,
    postcode VARCHAR(50) NOT NULL,
    country VARCHAR(255) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NULL,
    FOREIGN KEY (application_id) REFERENCES registration_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
    INDEX idx_application_id (application_id),
    INDEX idx_worker_id (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Worker employment history (related table)
CREATE TABLE worker_employment_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    application_id VARCHAR(50) NULL,
    worker_id VARCHAR(50) NULL,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(255) NULL,
    town VARCHAR(255) NULL,
    postcode VARCHAR(50) NULL,
    phone VARCHAR(50) NULL,
    email VARCHAR(255) NULL,
    role VARCHAR(255) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    reason VARCHAR(255) NULL,
    FOREIGN KEY (application_id) REFERENCES registration_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
    INDEX idx_application_id (application_id),
    INDEX idx_worker_id (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Worker referees (related table)
CREATE TABLE worker_referees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    application_id VARCHAR(50) NULL,
    worker_id VARCHAR(50) NULL,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    address VARCHAR(255) NULL,
    years VARCHAR(50) NOT NULL,
    relationship VARCHAR(255) NOT NULL,
    FOREIGN KEY (application_id) REFERENCES registration_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
    INDEX idx_application_id (application_id),
    INDEX idx_worker_id (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Worker qualifications (related table)
CREATE TABLE worker_qualifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    application_id VARCHAR(50) NULL,
    worker_id VARCHAR(50) NULL,
    name VARCHAR(255) NOT NULL,
    number VARCHAR(100) NULL,
    attained DATE NULL,
    expiry DATE NULL,
    FOREIGN KEY (application_id) REFERENCES registration_applications(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
    INDEX idx_application_id (application_id),
    INDEX idx_worker_id (worker_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attendance table
CREATE TABLE attendance (
    id VARCHAR(50) PRIMARY KEY,
    worker_id VARCHAR(50) NOT NULL,
    worker VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    check_in_time TIME NOT NULL,
    check_out_time TIME NOT NULL,
    location VARCHAR(255) NOT NULL,
    hours_worked DECIMAL(10, 2) NOT NULL,
    source ENUM('Self', 'Admin') NOT NULL,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
    INDEX idx_worker_id (worker_id),
    INDEX idx_date (date),
    INDEX idx_location (location)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Locations table
CREATE TABLE locations (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    address VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payroll table
CREATE TABLE payroll (
    id VARCHAR(50) PRIMARY KEY,
    worker_id VARCHAR(50) NOT NULL,
    worker VARCHAR(255) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    hours DECIMAL(10, 2) NOT NULL,
    overtime DECIMAL(10, 2) DEFAULT 0,
    rate DECIMAL(10, 2) NOT NULL,
    gross DECIMAL(10, 2) NOT NULL,
    advance_deduction DECIMAL(10, 2) DEFAULT 0,
    tax_ni DECIMAL(10, 2) NOT NULL,
    net_pay DECIMAL(10, 2) NOT NULL,
    status ENUM('Pending', 'Completed') DEFAULT 'Pending',
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE,
    INDEX idx_worker_id (worker_id),
    INDEX idx_status (status),
    INDEX idx_generated_at (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Buyer income table
CREATE TABLE buyer_income (
    id VARCHAR(50) PRIMARY KEY,
    buyer_name VARCHAR(255) NOT NULL,
    description VARCHAR(500) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    date DATE NOT NULL,
    status ENUM('Received', 'Pending') DEFAULT 'Pending',
    INDEX idx_buyer_name (buyer_name),
    INDEX idx_date (date),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Other costs table
CREATE TABLE other_costs (
    id VARCHAR(50) PRIMARY KEY,
    description VARCHAR(500) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    date DATE NOT NULL,
    INDEX idx_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings table (single row)
CREATE TABLE settings (
    id INT PRIMARY KEY DEFAULT 1,
    hourly_rate DECIMAL(10, 2) DEFAULT 14.50,
    overtime_multiplier DECIMAL(10, 2) DEFAULT 1.5,
    overtime_threshold DECIMAL(10, 2) DEFAULT 40,
    contract_months INT DEFAULT 3,
    tax_rate DECIMAL(10, 2) DEFAULT 20,
    ni_rate DECIMAL(10, 2) DEFAULT 12,
    pension_rate DECIMAL(10, 2) DEFAULT 5,
    max_advance DECIMAL(10, 2) DEFAULT 500,
    first_reminder_days INT DEFAULT 30,
    final_reminder_days INT DEFAULT 7,
    company_name VARCHAR(255) DEFAULT 'WorkHR Staffing Ltd',
    payroll_email VARCHAR(255) DEFAULT 'payroll@workhr.co.uk',
    billing_multiplier DECIMAL(10, 2) DEFAULT 1.45
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default settings
INSERT INTO settings (id) VALUES (1);

-- Notifications/Activity log table
CREATE TABLE notifications (
    id VARCHAR(50) PRIMARY KEY,
    worker VARCHAR(255) NOT NULL,
    worker_id VARCHAR(50) NULL,
    message TEXT NOT NULL,
    urgency ENUM('critical', 'warning', 'info') DEFAULT 'info',
    occurred_at VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE SET NULL,
    INDEX idx_urgency (urgency),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default admin user (password: admin123 - you should change this)
-- Password hash is bcryptjs hash of 'admin123'
INSERT INTO users (name, email, password_hash, role) VALUES
('Turja Sen', 'admin@workhr.com', '$2a$10$gvVfr3zBoCbKmuImoPgSeuvZxh36q.JkvC271sBqMfYMMZcZR1aTu', 'admin');

-- Insert default locations
INSERT INTO locations (id, name, address) VALUES
('LOC-01', 'Camden Site', '24 Camden High St, London NW1 0JH'),
('LOC-02', 'Hackney Depot', '112 Morning Lane, London E9 6LH'),
('LOC-03', 'Stratford Yard', '3 Angel Lane, London E15 1DF'),
('LOC-04', 'Croydon Hub', '60 George St, Croydon CR0 1PB');
