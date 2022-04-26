require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { Database, sha256, generateRandomID, isDoctor } = require('./utils');
const bodyParser = require('body-parser');
const path = require('path');
const PORT = process.env.PORT || 8000;

const app = express();

const db = new Database({
	host: process.env.HOST,
	user: process.env.USER,
	password: process.env.PASSWORD,
	database: process.env.DATABASE
});

const server = app.listen(PORT, () => `Listening on port ${PORT}`);

// Routes
const chatRoute = require('./routes/chat')(db, server);

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
		if(req.session.login.toString().padStart(10, '0').startsWith('1')) {
			res.render('doctor-dashboard', { auth: req.session.login });
		}
		else {
			res.render('dashboard', { auth: req.session.login });
		}
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

// Logged in user pages
app.use((req, res, next) => {
	if(!req.session.login) {
		res.redirect('/');
		return;
	}

	next();
});

app.use('/logout', (req, res) => {
	delete req.session.login;

	res.redirect('/');
});

// Handle chat
app.use('/chat', chatRoute);

// Patient Web Pages
app.all('/request-refill', async (req, res) => {
	if(req.method !== 'POST') {
		const patientPrescriptions = await db.run('SELECT prescriptionNum, prescriptionName, doctorID, (SELECT username FROM logininfo WHERE prescriptions.doctorID = logininfo.userID) AS username FROM prescriptions WHERE patientID = ?', req.session.login);

		return res.render('request-refill', { auth: req.session.login, patientPrescriptions });
	}
	
	const { prescription, reason_refill } = req.body;

	if(prescription === -1) {
		res.redirect('/?message=Error');
		return;
	}

	db.run('UPDATE prescriptions SET needsRefill = TRUE, reason = ?, refillApproved = NULL WHERE prescriptionNum = ?', reason_refill, prescription)
		.then(() => res.redirect('/?message=Successfully\x20requested\x20prescription'))
		.catch(() => res.redirect('/?message=Failed\x20to\x20send\x20request'));
});

app.get('/my-info', async (req, res) => {
	const result = await db.run('SELECT fname, lname, bloodtype, height, weight, hasHadSurgery, additionalNotes FROM medicalinfo JOIN patientdata USING(userID) WHERE userID = ?', req.session.login)

	if(!result || result.length <= 0) {
		res.redirect('/?message=No\x20medical\x20info\x20found');
	}

	const medicial_info = result[0];

	res.render('patient-info', { auth: req.session.login, ...medicial_info });
});

app.all('/create-appointment', async (req, res) => {
	if(req.method !== 'POST') {
		const users = await db.run('SELECT username, userID FROM logininfo WHERE userID != ?', req.session.login);
		const doctors = users.filter(user => isDoctor(user.userID));

		return res.render('appointment', { auth: req.session.login, doctors });
	}
	
	const { doctor, date, time, reason } = req.body;

	await db.run('INSERT INTO appointments VALUES (?, ?, ?, ?, ?)', generateRandomID(), req.session.login, doctor, date + ' ' + time, reason)
		.then(() => res.redirect('/?message=appointment created, I guess'))
		.catch(() => res.redirect('/create-appointment?message=There\x20was\x20an\x20error\x20try\x20again'));
});

app.all('/incident-form', async (req, res) => {
	if(req.method !== 'POST') {
		return res.render('incident-form', { auth: req.session.login });
	}

	const { date, time, information } = req.body;
	await db.run('INSERT INTO incidents (userID, incidentID, datetimeOfIncident, content, isResolved) VALUES (?, ?, ?, ?, NULL)', req.session.login, generateRandomID(), date + ' ' + time, information)
		.then(() => res.redirect('/?message=Incident\x20has\x20been\x20filed'))
		.catch(() => res.redirect('/incident-form?message=Sorry\x20there\x20was\x20an\x20error'));
});

// Doctor Pages
app.use((req, res, next) => {
	if(!isDoctor(req.session.login)) {
		res.redirect('/');
		return;
	}

	next();
});

app.get('/incident-response', async (req, res) => {
	// Retrieve incidents from DB
	const incidents = await db.run('SELECT incidentID, datetimeOfIncident, content, isResolved FROM incidents WHERE isResolved IS NULL');

	return res.render('incident-response', { auth: req.session.login, incidents });
});

app.post('/incident-response/:incidentID', async (req, res) => {
	const { incidentID } = req.params;
	const handle = () => {
		switch(req.body.resolve) {
			case 'resolve': return db.run('UPDATE incidents SET isResolved = TRUE WHERE incidentID = ?', incidentID);
			case 'reject': return db.run('UPDATE incidents SET isResolved = FALSE WHERE incidentID = ?', incidentID);
			default: return null;
		}
	}

	if(req.body.resolve === 'resolve' || req.body.resolve === 'reject') {
		return await handle()
			.then(() => res.redirect('/incident-response?message=Responded\x20or\x20something'))
			.catch(() => res.redirect('/incident-response?message=Failed\x20to\x20resolve'));
	}

	res.redirect('/incident-response');
})

app.get('/patient-refills', async (req, res) => {
	const refills = await db.run('SELECT prescriptionNum, fname, lname, prescriptionName, reason, dateOfLastRefill FROM prescriptions JOIN patientdata ON patientdata.userID = prescriptions.patientID WHERE doctorID = ? AND refillApproved IS NULL AND needsRefill = true', req.session.login);

	return res.render('refill-ack', { auth: req.session.login, refills });
});

app.post('/patient-refills/:prescriptionNum', async (req, res) => {
	const { prescriptionNum } = req.params;

	const handle = () => {
		switch(req.body.response) {
			case 'accept': return db.run('UPDATE prescriptions SET refillApproved = TRUE, needsRefill = FALSE WHERE prescriptionNum = ?', prescriptionNum);
			case 'reject': return db.run('UPDATE prescriptions SET refillApproved = FALSE, needsRefill = FALSE WHERE prescriptionNum = ?', prescriptionNum);
			default: return null;
		}
	}

	if(req.body.response === 'accept' || req.body.response === 'reject') {
		return await handle()
			.then(() => res.redirect('/patient-refills?message=Responded\x20or\x20something'))
			.catch(() => res.redirect('/patient-refills?message=Failed\x20to\x20resolve'));
	}

	res.redirect('/patient-refills');
})

app.get('/patient-info', async (req, res) => {
	const patients = await db.run('SELECT fname, lname, bloodtype, height, weight, hasHadSurgery, additionalNotes FROM medicalinfo JOIN patientdata using(userID)')

	res.render('view-patient-info', { auth: req.session.login, patients });
})

app.get('/doctor-appointments', async (req, res) => {
	const appointments = await db.run('SELECT fname, lname, reason, datetimeOfAppt FROM appointments JOIN patientdata ON patientdata.userID = appointments.patientID WHERE doctorID = ?', req.session.login);

	res.render('appointments', { auth: req.session.login, appointments });
});
