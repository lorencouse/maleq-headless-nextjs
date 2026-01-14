-- CreateTable
CREATE TABLE `Manufacturer` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Manufacturer_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductType` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `parentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductType_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `shortDescription` TEXT NULL,
    `price` DECIMAL(10, 2) NULL,
    `retailPrice` DECIMAL(10, 2) NULL,
    `salePrice` DECIMAL(10, 2) NULL,
    `onSale` BOOLEAN NOT NULL DEFAULT false,
    `stockQuantity` INTEGER NOT NULL DEFAULT 0,
    `stockStatus` ENUM('IN_STOCK', 'OUT_OF_STOCK', 'LOW_STOCK', 'ON_BACKORDER') NOT NULL DEFAULT 'OUT_OF_STOCK',
    `lastStockUpdate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `active` BOOLEAN NOT NULL DEFAULT true,
    `weight` DECIMAL(10, 2) NULL,
    `length` DECIMAL(10, 2) NULL,
    `width` DECIMAL(10, 2) NULL,
    `height` DECIMAL(10, 2) NULL,
    `upcCode` VARCHAR(191) NULL,
    `manufacturerSku` VARCHAR(191) NULL,
    `releaseDate` DATETIME(3) NULL,
    `manufacturerId` VARCHAR(191) NULL,
    `productTypeId` VARCHAR(191) NULL,
    `source` ENUM('WILLIAMS_TRADING', 'WORDPRESS', 'MANUAL') NOT NULL DEFAULT 'WILLIAMS_TRADING',
    `rawData` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Product_sku_key`(`sku`),
    INDEX `Product_sku_idx`(`sku`),
    INDEX `Product_manufacturerId_idx`(`manufacturerId`),
    INDEX `Product_productTypeId_idx`(`productTypeId`),
    INDEX `Product_active_idx`(`active`),
    INDEX `Product_stockStatus_idx`(`stockStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductImage` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `localPath` VARCHAR(191) NULL,
    `localFileName` VARCHAR(191) NULL,
    `imageAlt` VARCHAR(191) NULL,
    `imageTitle` VARCHAR(191) NULL,
    `isProcessed` BOOLEAN NOT NULL DEFAULT false,
    `processedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductImage_productId_idx`(`productId`),
    INDEX `ProductImage_isProcessed_idx`(`isProcessed`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StockHistory` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `previousQty` INTEGER NOT NULL,
    `newQty` INTEGER NOT NULL,
    `previousStatus` ENUM('IN_STOCK', 'OUT_OF_STOCK', 'LOW_STOCK', 'ON_BACKORDER') NOT NULL,
    `newStatus` ENUM('IN_STOCK', 'OUT_OF_STOCK', 'LOW_STOCK', 'ON_BACKORDER') NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `StockHistory_productId_idx`(`productId`),
    INDEX `StockHistory_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncLog` (
    `id` VARCHAR(191) NOT NULL,
    `syncType` ENUM('FULL_SYNC', 'STOCK_UPDATE', 'MANUFACTURERS', 'PRODUCT_TYPES', 'PRODUCTS', 'IMAGES') NOT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED') NOT NULL,
    `recordsTotal` INTEGER NOT NULL DEFAULT 0,
    `recordsAdded` INTEGER NOT NULL DEFAULT 0,
    `recordsUpdated` INTEGER NOT NULL DEFAULT 0,
    `recordsFailed` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `SyncLog_syncType_idx`(`syncType`),
    INDEX `SyncLog_status_idx`(`status`),
    INDEX `SyncLog_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProductType` ADD CONSTRAINT `ProductType_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ProductType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_manufacturerId_fkey` FOREIGN KEY (`manufacturerId`) REFERENCES `Manufacturer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_productTypeId_fkey` FOREIGN KEY (`productTypeId`) REFERENCES `ProductType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductImage` ADD CONSTRAINT `ProductImage_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StockHistory` ADD CONSTRAINT `StockHistory_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
