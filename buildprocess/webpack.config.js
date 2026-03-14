/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-require-imports */

const configureWebpackForTerriaJS = require("terriajs/buildprocess/configureWebpack");
const configureWebpackForPlugins = require("./configureWebpackForPlugins");
const defaultBabelLoader = require("terriajs/buildprocess/defaultBabelLoader");
const fs = require("fs");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const path = require("path");
const HtmlPlugin = require("html-webpack-plugin");
const webpack = require("webpack");

function readEnvValue(filePath, key) {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const match = fs
    .readFileSync(filePath, "utf8")
    .match(new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`, "m"));

  if (!match) {
    return undefined;
  }

  return match[1].replace(/^['"]|['"]$/g, "");
}

/**
 * Webpack config for building terriamap
 */
module.exports = function ({ devMode, baseHref = "/" }) {
  const googleMapTilesApiKey =
    process.env.GOOGLE_MAP_TILES_API_KEY ||
    readEnvValue(
      path.resolve(__dirname, "..", ".env.local"),
      "GOOGLE_MAP_TILES_API_KEY"
    ) ||
    "";

  // Base configuration
  const config = {
    mode: devMode ? "development" : "production",
    entry: "./entry.js",
    output: {
      path: path.resolve(__dirname, "..", "wwwroot", "build"),
      filename: "TerriaMap.js",
      publicPath: "build/",
      sourcePrefix: "", // to avoid breaking multi-line string literals by inserting extra tabs.
      globalObject: "(self || window)" // to avoid breaking in web worker (https://github.com/webpack/webpack/issues/6642)
    },
    devtool: devMode ? "eval-cheap-module-source-map" : false,

    module: {
      // following rules are for terriamap source files
      // rules for building terriajs are configured in configureWebpackForTerriaJS
      rules: [
        // build source files
        {
          test: /\.(ts|js)x?$/,
          include: [
            path.resolve(__dirname, "..", "index.js"),
            path.resolve(__dirname, "..", "entry.js"),
            path.resolve(__dirname, "..", "plugins.ts"),
            path.resolve(__dirname, "..", "lib")
          ],
          use: [defaultBabelLoader({ devMode })]
        },
        // import html file as string
        {
          test: /\.html$/,
          include: path.resolve(__dirname, "..", "lib", "Views"),
          type: "asset/source"
        },
        // import images
        {
          test: /\.(png|jpg|svg|gif)$/,
          include: path.resolve(__dirname, "..", "wwwroot", "images"),
          type: "asset" // inlines as data url if size < 8kb
        },
        // import globe.gif
        {
          test: /globe\.gif$/,
          include: path.resolve(__dirname, "..", "lib", "Styles"),
          type: "asset",
          parser: {
            dataUrlCondition: {
              maxSize: 65536 // < inline as data url if size < 64k
            }
          }
        },
        // handle scss files
        {
          test: /\.scss$/,
          include: [path.resolve(__dirname, "..", "lib")],
          use: [
            {
              loader: MiniCssExtractPlugin.loader,
              options: {
                // Use default export for css modules as opposed to the more
                // efficient named exports. This is required because most of
                // legacy stylesheets in TerriaJS assumes default export style.
                defaultExport: true
              }
            },
            { loader: "terriajs-typings-for-css-modules-loader" },
            {
              loader: "css-loader",
              options: {
                sourceMap: true,
                modules: {
                  localIdentName: "tjs-[name]__[local]",
                  exportLocalsConvention: "camelCase"
                },
                importLoaders: 2
              }
            },
            {
              loader: "resolve-url-loader",
              options: {
                sourceMap: false
              }
            },
            {
              loader: "sass-loader",
              options: {
                api: "modern",
                sassOptions: {
                  sourceMap: true
                }
              }
            }
          ]
        }
      ]
    },
    plugins: [
      new webpack.DefinePlugin({
        "process.env.GOOGLE_MAP_TILES_API_KEY":
          JSON.stringify(googleMapTilesApiKey)
      }),
      // Extract SASS styles into a seperate stylesheet
      new MiniCssExtractPlugin({
        filename: "TerriaMap.css",
        ignoreOrder: true
      }),
      new HtmlPlugin({
        filename: path.resolve(__dirname, "..", "wwwroot", "index.html"),
        template: path.resolve(__dirname, "..", "wwwroot", "index.ejs"),
        templateParameters: {
          baseHref: baseHref
        }
      })
    ],
    resolve: {
      alias: {},
      modules: ["node_modules"]
    }
  };
  config.resolve.alias["terriajs-variables"] = require.resolve(
    "../lib/Styles/variables-overrides.scss"
  );

  return configureWebpackForPlugins(
    configureWebpackForTerriaJS({
      terriaJSBasePath: path.dirname(require.resolve("terriajs/package.json")),
      config,
      devMode,
      MiniCssExtractPlugin
    })
  );
};
