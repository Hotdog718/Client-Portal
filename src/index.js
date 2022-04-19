require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { Database, sha256, generateRandomID } = require('./utils');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const db = new Database({
	host: process.env.HOST,
	user: process.env.USER,
	password: process.env.PASSWORD,
	database: process.env.DATABASE
});

const PORT = process.env.PORT || 8000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({
	extended: false
}));

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
	secret: crypto.randomBytes(32).toString(),
	resave: false,
	saveUninitialized: false
}));

app.get('/', async (req, res) => {
	if(req.session?.login) {
		res.render('dashboard', { auth: req.session.login});
		return;
	}
	res.render('index');
});

app.all('/register', async (req, res) => {
	if(req.method !== 'POST') {
		return res.render('register');
	}

	const { username, password } = req.body;
	const patientID = generateRandomID();

	const result = await db.run('SELECT username FROM logininfo WHERE username = ?', username);

	if(result && result?.length > 0) {
		return res.redirect('/register?message=This\x20username%20is\x20taken');
	}

	try {
		// Create patient login on database
		await db.run('INSERT INTO logininfo (username, passw, userID) VALUES (?, ?, ?)', username, sha256(password), patientID);
		res.redirect('/login');
	}
	catch(err) {
		console.error(err);
		res.redirect('/register?message=Something\x20went\x20wrong');
	}
});

app.all('/login', async (req, res) => {
	if(req.method !== 'POST') {
		return res.render('login');
	}

	const { username, password } = req.body;

	const result = await db.run('SELECT username, passw, userID FROM logininfo WHERE username = ?', username);

	if(!result || result?.length <= 0) {
		return res.redirect('/login?message=Incorrect\x20Username\x20and/or\x20password');
	}
	
	if (result[0].passw !== sha256(password)) {
		return res.redirect('/login?message=Incorrect\x20Username\x20and/or\x20password');
	}

	req.session.login = result[0].userID;

	res.redirect('/');
});

app.use((req, res, next) => {
	if(!req.session.login) {
		res.redirect('/');
		return;
	}

	next();
})

app.get('/my-info', async (req, res) => {
	const result = await db.run('SELECT bloodtype, height, weight, hasHadSurgery, additionalNotes FROM medicalinfo WHERE userID = ?', req.session.login)

	if(!result || result.length <= 0) {
		res.redirect('/?message=No\x20medical\x20info\x20found');
	}

	const medicial_info = result[0];

	res.render('patient-info', { auth: req.session.login, ...medicial_info });
})

app.all('/create-appointment', async (req, res) => {
	if(req.method !== 'POST') {
		return res.render('appointment', { auth: req.session.login });
	}
	
	res.redirect('/?message=appointment created, I guess');
});

app.use('/logout', (req, res) => {
	delete req.session.login;

	res.redirect('/');
});

app.listen(PORT);