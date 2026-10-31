const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "../src/modules/auth/controllers/authController.js"),
  "utf8"
);

function loadController(user) {
  let tokenPayload;
  const mocks = {
    bcryptjs: {
      compare: async () => true,
      genSalt: async () => "salt",
      hash: async () => "hashed-password",
    },
    jsonwebtoken: {
      sign: (payload) => { tokenPayload = payload; return "test-token"; },
    },
    "../../users/models/User": {
      findOne: async () => user,
      create: async () => user,
    },
    "../../teachers/models/Teacher": { findById: async () => ({ id: 7 }) },
  };
  const context = {
    module: { exports: {} },
    require: (name) => {
      assert.ok(mocks[name], `Unexpected dependency: ${name}`);
      return mocks[name];
    },
    process: { env: { JWT_SECRET: "test-secret" } },
  };
  vm.runInNewContext(source, context);
  return { ...context.module.exports, payload: () => tokenPayload, mocks };
}

test("AttendanceTaker registration requires no teacher profile; Teacher registration does", async () => {
  const user = { id: 20, fullName: "Class attendance taker", phone: "test-unlinked", password: "hashed", role: "AttendanceTaker", teacherId: null, departmentIds: [] };
  const controller = loadController(user);
  controller.mocks["../../users/models/User"].findOne = async () => null;
  controller.mocks["../../teachers/models/Teacher"].findById = async () => { throw new Error("An unlinked attendance taker must not require a teacher lookup"); };
  const res = response();
  await controller.registerUser({ body: user }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.user.teacherId, null);
  const teacherRes = response();
  await controller.registerUser({ body: { ...user, role: "Teacher" } }, teacherRes);
  assert.equal(teacherRes.statusCode, 400);
});

function response() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
  };
}

for (const identity of [{ id: 12 }, { _id: "legacy-user-id" }]) {
  for (const action of ["loginUser", "registerUser"]) {
    test(`${action} supplies both user ID fields for ${Object.keys(identity)[0]} accounts`, async () => {
      const user = {
        ...identity,
        fullName: "Test Teacher",
        phone: "test-phone",
        password: "hashed-password",
        role: "AttendanceTaker",
        teacherId: 7,
        departmentId: 3,
        departmentIds: [3],
        attendanceShift: "Morning",
      };
      const controller = loadController(user);
      if (action === "registerUser") controller.mocks["../../users/models/User"].findOne = async () => null;
      const res = response();
      await controller[action]({ body: { ...user, password: "test-password" } }, res);
      const id = identity.id ?? identity._id;
      assert.equal(res.statusCode, action === "registerUser" ? 201 : 200);
      assert.equal(res.body.user.id, id);
      assert.equal(res.body.user._id, id);
      assert.equal(controller.payload().id, id);
      assert.equal(res.body.user.teacherId, 7);
      assert.equal(res.body.user.role, "AttendanceTaker");
      assert.equal(res.body.user.attendanceShift, "Morning");
      assert.equal(res.body.user.password, undefined);
    });
  }
}
