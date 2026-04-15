module.exports = {
  roots: ['<rootDir>/src/', '<rootDir>/test/'],
  transform: {
    '^.+\\.[jt]sx?$': 'ts-jest'
  },
  testRegex: '(/__tests__/.*|\\.(test|spec))\\.[tj]sx?$',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@actions/([^/]+)$': '<rootDir>/node_modules/@actions/$1',
    '^@actions/([^/]+)/(.*)$': '<rootDir>/node_modules/@actions/$1/$2'
  },
  transformIgnorePatterns: [
    'node_modules/(?!@actions/)'
  ]
}
