module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	globalSetup: '<rootDir>/jest.setup.js',
	testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
}
