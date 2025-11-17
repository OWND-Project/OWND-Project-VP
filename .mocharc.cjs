// process.env.XXX=""
process.env.NODE_ENV = "test";

module.exports = {
  extension: ["ts"],
  spec: "tests/**/*.test.*",
  "node-option": [
    "experimental-specifier-resolution=node",
    "loader=ts-node/esm",
    "enable-source-maps",
  ],
};
