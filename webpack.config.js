const path = require('path');
    module.exports = {
      mode: 'production',
      entry: './src/index.js',      
      output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'trumpet-puppet.bundle.js'
      },
      module: {
        rules: [{ test: /\.txt$/, use: 'raw-loader' }]
      },
      resolve: {
        alias: {
          'node_modules': path.join(__dirname, 'node_modules'),
        }
      }
    };