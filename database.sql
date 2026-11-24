CREATE DATABASE IF NOT EXISTS bookstoriaga CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE bookstoriaga;

CREATE TABLE IF NOT EXISTS users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('Owner','Staff') NOT NULL DEFAULT 'Staff',
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  contact VARCHAR(120),
  phone VARCHAR(40),
  email VARCHAR(150),
  lead_days INT NOT NULL DEFAULT 0,
  tags JSON NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS inventory_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(80) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  author VARCHAR(200),
  cover_url TEXT,
  description TEXT,
  tags JSON NULL,
  supplier_id INT NULL,
  cost_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  sell_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock INT NOT NULL DEFAULT 0,
  low_threshold INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_item_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  type ENUM('SELL','RESTOCK') NOT NULL,
  item_id INT NOT NULL,
  qty INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  unit_cost DECIMAL(12,2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_transaction_item FOREIGN KEY (item_id) REFERENCES inventory_items(item_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor VARCHAR(180) NOT NULL,
  action VARCHAR(80) NOT NULL,
  target VARCHAR(200) NOT NULL,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- (password: password123)
INSERT IGNORE INTO users(full_name,email,password_hash,role,active) VALUES
('Bookstoriaga Admin','owner@bookstoriaga.ph',
 '$2y$12$Aej11b1081JJW9.ik/86nOuYZ91abiPuJdxX4i9TLoawJ4TP7rl3G','Owner',1);

