CREATE DATABASE IF NOT EXISTS `kinaadman`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `kinaadman`;

SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `email` VARCHAR(100) NOT NULL UNIQUE,
  `fullname` VARCHAR(100) NOT NULL,
  `role` ENUM('admin','staff','user') NOT NULL DEFAULT 'user',
  `reset_token` VARCHAR(255) NULL,
  `reset_token_expiry` BIGINT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `active` BOOLEAN NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `transactions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `docno` VARCHAR(20) NOT NULL UNIQUE,
  `type` ENUM('receipt','invoice') NOT NULL,
  `client` VARCHAR(255) NOT NULL,
  `address` TEXT,
  `tin` VARCHAR(20),
  `bizstyle` VARCHAR(100),
  `phone` VARCHAR(20),
  `description` TEXT,
  `archived` BOOLEAN DEFAULT 0,
  `archived_auto` BOOLEAN NOT NULL DEFAULT 0,
  `qty` INT NOT NULL DEFAULT 1,
  `unitprice` DECIMAL(12,2),
  `amount` DECIMAL(12,2) NOT NULL,
  `downpayment` DECIMAL(12,2) NOT NULL DEFAULT 0,
  `checkno` VARCHAR(100),
  `pono` VARCHAR(100),
  `date` DATE NOT NULL,
  `status` ENUM('paid','unpaid','partial') NOT NULL DEFAULT 'unpaid',
  `pdfFilename` VARCHAR(255),
  `project_members` VARCHAR(255),
  `member_role` VARCHAR(50),
  `member_phone` VARCHAR(20),
  `project_members_2` VARCHAR(255),
  `member_role_2` VARCHAR(50),
  `member_phone_2` VARCHAR(20),
  `project_members_3` VARCHAR(255),
  `member_role_3` VARCHAR(50),
  `member_phone_3` VARCHAR(20),
  `project_start_date` DATE,
  `project_end_date` DATE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `products` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `sku` VARCHAR(50) NOT NULL UNIQUE,
  `name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(100),
  `description` TEXT,
  `unit_price` DECIMAL(12,2) NOT NULL,
  `reorder_level` INT DEFAULT 10,
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `warehouses` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `name` VARCHAR(100) NOT NULL UNIQUE,
  `location` VARCHAR(255),
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `vendors` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `vendor_name` VARCHAR(255) NOT NULL,
  `contact_person` VARCHAR(100),
  `email` VARCHAR(100),
  `phone` VARCHAR(20),
  `address` TEXT,
  `tin` VARCHAR(20),
  `is_active` BOOLEAN DEFAULT TRUE,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `projects` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_name` VARCHAR(255) NOT NULL,
  `transaction_id` INT NULL,
  `source_docno` VARCHAR(20),
  `description` TEXT,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `planned_start_date` DATE DEFAULT NULL,
  `planned_end_date` DATE DEFAULT NULL,
  `actual_start_date` DATE DEFAULT NULL,
  `actual_end_date` DATE DEFAULT NULL,
  `status_reason` TEXT,
  `paused_at` DATE DEFAULT NULL,
  `cancelled_at` DATE DEFAULT NULL,
  `project_manager` VARCHAR(100),
  `status` ENUM('planning','active','on_hold','completed','cancelled') DEFAULT 'planning',
  `priority` ENUM('low','medium','high','critical') DEFAULT 'medium',
  `is_archived` BOOLEAN NOT NULL DEFAULT 0,
  `archived_auto` BOOLEAN NOT NULL DEFAULT 0,
  `budget` DECIMAL(15,2) NOT NULL,
  `members` VARCHAR(255),
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_projects_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `warehouse_id` INT NOT NULL,
  `quantity` INT NOT NULL DEFAULT 0,
  `last_updated` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_stock` (`product_id`, `warehouse_id`),
  CONSTRAINT `fk_stock_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `fk_stock_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_movements` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `product_id` INT NOT NULL,
  `warehouse_id` INT NOT NULL,
  `movement_type` ENUM('inbound','outbound','adjustment') NOT NULL,
  `quantity` INT NOT NULL,
  `reference_doc` VARCHAR(100),
  `notes` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_stock_movements_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`),
  CONSTRAINT `fk_stock_movements_warehouse` FOREIGN KEY (`warehouse_id`) REFERENCES `warehouses` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `po_number` VARCHAR(50) NOT NULL UNIQUE,
  `vendor_id` INT NOT NULL,
  `po_date` DATE NOT NULL,
  `delivery_date` DATE,
  `total_amount` DECIMAL(12,2) NOT NULL,
  `status` ENUM('draft','pending','approved','received','cancelled') DEFAULT 'draft',
  `notes` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_purchase_orders_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `po_line_items` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `po_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `quantity` INT NOT NULL,
  `unit_price` DECIMAL(12,2) NOT NULL,
  `line_total` DECIMAL(12,2) NOT NULL,
  `received_qty` INT DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_po_line_items_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`),
  CONSTRAINT `fk_po_line_items_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts_payable` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `vendor_id` INT NOT NULL,
  `bill_number` VARCHAR(50) NOT NULL UNIQUE,
  `invoice_number` VARCHAR(50),
  `bill_date` DATE NOT NULL,
  `due_date` DATE,
  `po_id` INT NULL,
  `total_amount` DECIMAL(12,2) NOT NULL,
  `paid_amount` DECIMAL(12,2) DEFAULT 0,
  `status` ENUM('draft','pending','approved','partially_paid','paid','cancelled') DEFAULT 'pending',
  `notes` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_accounts_payable_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`),
  CONSTRAINT `fk_accounts_payable_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `accounts_receivable` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `customer_name` VARCHAR(255) NOT NULL,
  `invoice_number` VARCHAR(50) NOT NULL UNIQUE,
  `invoice_date` DATE NOT NULL,
  `due_date` DATE,
  `total_amount` DECIMAL(12,2) NOT NULL,
  `paid_amount` DECIMAL(12,2) DEFAULT 0,
  `status` ENUM('draft','sent','partial','paid','overdue','cancelled') DEFAULT 'draft',
  `transaction_id` INT NULL,
  `notes` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_accounts_receivable_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `payment_type` ENUM('ap','ar') NOT NULL,
  `ap_id` INT NULL,
  `ar_id` INT NULL,
  `payment_date` DATE NOT NULL,
  `amount` DECIMAL(12,2) NOT NULL,
  `payment_method` ENUM('cash','check','bank_transfer','credit_card') DEFAULT 'cash',
  `reference_number` VARCHAR(100),
  `notes` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_payments_ap` FOREIGN KEY (`ap_id`) REFERENCES `accounts_payable` (`id`),
  CONSTRAINT `fk_payments_ar` FOREIGN KEY (`ar_id`) REFERENCES `accounts_receivable` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_logs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NULL,
  `action` VARCHAR(100) NOT NULL,
  `details` TEXT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_system_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `task_name` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `duration` INT,
  `progress` INT DEFAULT 0,
  `assigned_to` VARCHAR(100),
  `status` ENUM('not_started','in_progress','on_hold','completed','cancelled') DEFAULT 'not_started',
  `plan_cost` DECIMAL(12,2) DEFAULT 0,
  `actual_cost` DECIMAL(12,2) DEFAULT 0,
  `dependencies` INT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_tasks_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `project_costs` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `task_id` INT NULL,
  `cost_category` VARCHAR(100),
  `plan_amount` DECIMAL(12,2) NOT NULL,
  `actual_amount` DECIMAL(12,2) DEFAULT 0,
  `variance` DECIMAL(12,2),
  `cost_date` DATE,
  `notes` TEXT,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_project_costs_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_project_costs_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `project_resources` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `project_id` INT NOT NULL,
  `task_id` INT NULL,
  `resource_name` VARCHAR(100) NOT NULL,
  `resource_type` ENUM('labor','material','equipment','other') DEFAULT 'labor',
  `quantity` DECIMAL(10,2),
  `unit_cost` DECIMAL(12,2),
  `allocation` INT DEFAULT 100,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_project_resources_project` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`),
  CONSTRAINT `fk_project_resources_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `users` (`username`, `password`, `email`, `fullname`, `role`, `active`)
VALUES (
  'admin',
  '$2b$10$nFt5iVWEOKVTWXDLoxUgHOAngaS/TLDgd8IlEIPgvXhyWdxBeGlrq',
  'admin@kinaadman.com',
  'Administrator',
  'admin',
  1
)
ON DUPLICATE KEY UPDATE
  `password` = VALUES(`password`),
  `fullname` = VALUES(`fullname`),
  `role` = VALUES(`role`),
  `active` = VALUES(`active`);

SET FOREIGN_KEY_CHECKS = 1;
