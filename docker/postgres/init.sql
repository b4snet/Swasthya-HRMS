-- Swasthya HRMS local dev bootstrap.
-- Matches DATABASE_URL in .env.example. Dev credentials only — never use in
-- any shared, staging, or production environment.
CREATE DATABASE swasthya_hrms_test;
GRANT ALL PRIVILEGES ON DATABASE swasthya_hrms_test TO swasthya_dev;
