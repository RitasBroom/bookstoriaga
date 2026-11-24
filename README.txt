# Bookstoriaga PHP + MySQL version

## Requirements
- XAMPP (Apache, PHP 8+, MySQL/MariaDB)
- The original `styles.css` and `assets/` folder from your frontend project

## Installation
1. Copy the `bookstoriaga_php` folder into `C:\xampp\htdocs\`.
2. Start Apache and MySQL in the XAMPP Control Panel.
3. Open `http://localhost/phpmyadmin`.
4. Import `database.sql` (select the file and click Import).
5. If your MySQL root account has a password, edit `$pass` in `api.php`.
6. Put your original `styles.css` file and `assets` folder beside `index.html` (the uploaded files did not include these).
7. Open `http://localhost/bookstoriaga_php/`.

## Demo accounts
- Owner: `owner@bookstoriaga.ph` / `password123`
- Staff: `staff@bookstoriaga.ph` / `password123`

## What is now stored in MySQL
Users, categories, suppliers, inventory, sales/restock transactions, and audit logs.
The browser only keeps the theme preference and a display copy of the current user; the PHP session handles authentication.

## Important
The prototype's "forgot password" flow only verifies that an email exists and then allows a password reset. This is not secure enough for a public/production website. A real deployment needs email verification tokens, HTTPS, CSRF protection, stronger authorization checks, backups, and production credentials.
