const path = require('path');
const { Extension } = require('typescript');
module.exports = {
  mode: 'development',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'trumpet-puppet.bundle.js'
  },
  module: {
    rules: [{ test: /\.txt$/, use: 'raw-loader' }]
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      'node_modules': path.join(__dirname, 'node_modules'),
    }
  },
  devServer: {
    static: path.join(__dirname, '/'),
    devMiddleware: {
      publicPath: '/dist/'
    },
    port: 5173,
    hot: "only"
  },  
};