import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import readline from 'readline';

const prisma = new PrismaClient();
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log('👤 Create New User');
    console.log('------------------');

    try {
        const name = await question('Full Name: ');
        const email = await question('Email Address: ');

        // Check if user already exists
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            console.error('❌ Error: A user with this email already exists.');
            process.exit(1);
        }

        const password = await question('Password: ');
        const businessName = await question('Business Name (Optional): ');

        console.log('\nCreating user...');
        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                businessName: businessName || null,
            },
        });

        console.log(`✅ Success! User created with ID: ${user.id}`);
        console.log(`You can now log in with ${email}`);

    } catch (error) {
        console.error('❌ Error creating user:', error);
    } finally {
        await prisma.$disconnect();
        rl.close();
    }
}

main();
