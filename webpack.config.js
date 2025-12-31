const path = require('path');
const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development', // Set to 'production' for optimized builds
  entry: './src/index.ts', // Entry point for your application
  output: {
    filename: 'bundle.js', // Name of the bundled output file
    path: path.resolve(__dirname, 'dist'), // Output directory
    clean: true, // Clean the output directory before each build
  },
  devtool: 'inline-source-map', // Source maps for debugging in VS Code
  module: {
    rules: [
      {
        test: /\.ts$/, // Rule to process TypeScript files
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'], // Resolve .ts and .js extensions
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './public/index.html', // Use the template in the public folder
    }),
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'dist'), // Serve files from the dist directory
    },
    port: 8080, // Port for the development server
    open: true, // Open the browser after starting the server
    host: '0.0.0.0',
    // Use `server` config for webpack-dev-server v5. If certs exist, provide them; otherwise use https type.
    server: (() => {
      const certPath = path.join(__dirname, 'certs', 'localhost.pem');
      const keyPath = path.join(__dirname, 'certs', 'localhost.key');
      if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        return {
          type: 'https',
          options: {
            cert: fs.readFileSync(certPath),
            key: fs.readFileSync(keyPath)
          }
        };
      }
      return { type: 'https' };
    })(),
  },
};
