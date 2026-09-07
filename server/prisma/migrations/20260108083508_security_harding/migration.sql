-- AlterTable
ALTER TABLE "OtpCode" ALTER COLUMN "identifier" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "accountStatus" SET DEFAULT 'UNVERIFIED',
ALTER COLUMN "hasRecoveryMethod" SET DEFAULT false;
