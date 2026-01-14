-- AlterTable
ALTER TABLE `Product` ADD COLUMN `isVariableProduct` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `parentProductId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `ProductVariationAttribute` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ProductVariationAttribute_productId_idx`(`productId`),
    INDEX `ProductVariationAttribute_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Product_parentProductId_idx` ON `Product`(`parentProductId`);

-- CreateIndex
CREATE INDEX `Product_isVariableProduct_idx` ON `Product`(`isVariableProduct`);

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_parentProductId_fkey` FOREIGN KEY (`parentProductId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductVariationAttribute` ADD CONSTRAINT `ProductVariationAttribute_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
