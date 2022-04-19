const mySQL = require('mysql2');
const crypto = require('crypto');

class Database {
	constructor(settings = {}) {
		this.connection = mySQL.createConnection(settings);

		this.connection.connect((err) => {
			if(err) {
				console.error('error connecting: ' + err.stack);
				return;
			}

			console.log('connected as id ' + this.connection.threadId);
		});

		process.on('exit', () => {
			this.connection.end();
		})
	}

	run(query, ...params) {
		return new Promise((resolve, reject) => {
			this.connection.query({
				sql: query,
				timeout: 10000,
				values: params
			}, function(err, res, fields) {
				if(err) reject(err);
				
				resolve(res);
			})
		})
	}
}

const sha256 = (message) => {
	// Hash the Message
	const hash = crypto.createHash('sha256');
	hash.update(message);
	const hashBuffer = hash.copy().digest('hex');

	return hashBuffer;
}

const generateRandomID = () => {
	const id = crypto.randomBytes(5).toString('hex');
	
	return id;
}

module.exports = {
	Database,
	sha256,
	generateRandomID
};