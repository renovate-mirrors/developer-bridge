import vorpal from 'vorpal';

import AppContext from '../models/AppContext';
import commandTestHarness from '../testUtils/commandTestHarness';
import HostConnections from '../models/HostConnections';
import install from './install';
import * as sideload from '../models/sideload';

import { buildAction } from './build';
import { connectAction } from './connect';
import { setAppPackageAction } from './setAppPackage';

jest.mock('fs');
jest.mock('../models/sideload');
jest.mock('./build');
jest.mock('./connect');
jest.mock('./setAppPackage');

interface SideloadError extends Error {
  component?: string;
}

const mockAppPackage = {
  components: {
    device: {
      higgs: {},
    },
  },
};

const mockAppPackageWithCompanion = {
  components: {
    device: {
      higgs: {},
    },
    companion: {},
  },
};

const mockAppPackageCompanionOnly = {
  components: {
    companion: {},
  },
};

const mockDevice = {
  host: {
    rpc: {
      ended: false,
    },
    launchAppComponent: jest.fn(),
  },
};

const mockPhone = {
  host: {
    rpc: {
      ended: false,
    },
  },
};

let cli: vorpal;
let mockLog: jest.Mock;
let sideloadAppSpy: jest.MockInstance<typeof sideload.app>;
let sideloadCompanionSpy: jest.MockInstance<typeof sideload.companion>;

let appContext: AppContext;
let hostConnections: HostConnections;

function doInstall() {
  return cli.exec('install');
}

function expectConnect(deviceType: string) {
  expect(connectAction).toBeCalledWith(
    expect.anything(),
    deviceType,
    hostConnections,
  );
}

beforeEach(() => {
  appContext = new AppContext();
  (setAppPackageAction as any).mockImplementation(() => Promise.resolve(appContext.appPackage));
  hostConnections = new HostConnections();
  ({ cli, mockLog } = commandTestHarness(install({ appContext, hostConnections })));
  sideloadAppSpy = jest.spyOn(sideload, 'app');
  sideloadCompanionSpy = jest.spyOn(sideload, 'companion');

  sideloadAppSpy.mockResolvedValue({ installType: 'full' });
  sideloadCompanionSpy.mockResolvedValue({ installType: 'full' });
});

it('loads the app at provided path', async () => {
  await cli.exec('install app.fba');
  expect(setAppPackageAction).toBeCalledWith(
    expect.anything(),
    appContext,
    'app.fba',
  );
});

it('logs an error if loaded app contains no components', async () => {
  appContext.appPackage = {} as any;
  await doInstall();
  expect(mockLog.mock.calls[0]).toMatchSnapshot();
});

describe('when an app is loaded', () => {
  beforeEach(() => {
    appContext.appPackage = mockAppPackage as any;
  });

  it('loads a new app when a path is provided', async () => {
    await cli.exec('install app.fba');
    expect(setAppPackageAction).toBeCalledWith(
      expect.anything(),
      appContext,
      'app.fba',
    );
  });

  it('reloads the app package from disk', async () => {
    await doInstall();
    expect(setAppPackageAction).toBeCalled();
  });

  it('connects a device if no device is connected', async () => {
    await doInstall();
    expectConnect('device');
  });

  describe('when a device is connected', () => {
    beforeEach(() => {
      hostConnections.appHost = mockDevice as any;
    });

    describe('when sideloading fails', () => {
      beforeEach(() => {
        const sideloadError: SideloadError = new Error('sideload failed!');
        sideloadError.component = 'app';
        sideloadAppSpy.mockRejectedValueOnce(sideloadError);
        return doInstall();
      });

      it('logs a message', () => {
        expect(mockLog.mock.calls[0]).toMatchSnapshot();
      });

      it('does not launch the app', () => {
        expect(mockDevice.host.launchAppComponent).not.toBeCalled();
      });
    });

    describe('when sideloading is successful', () => {
      beforeEach(doInstall);

      it('sideloads the app', () => {
        expect(sideloadAppSpy).toBeCalled();
      });

      it('launches the app', () => {
        expect(mockDevice.host.launchAppComponent).toBeCalled();
      });
    });

    describe('when the build is already installed', () => {
      beforeEach(() => {
        sideloadAppSpy.mockResolvedValueOnce(null);
        return doInstall();
      });

      it('launches the app', () => {
        expect(mockDevice.host.launchAppComponent).toBeCalled();
      });
    });
  });
});

describe('when an app with a companion is loaded', () => {
  beforeEach(() => {
    appContext.appPackage = mockAppPackageWithCompanion as any;
    hostConnections.appHost = mockDevice as any;
  });

  it('connects a phone if no phone is connected', async () => {
    await doInstall();
    expectConnect('phone');
  });

  describe('when a phone is connected', () => {
    beforeEach(() => {
      hostConnections.companionHost = mockPhone as any;
    });

    describe.each([
      'full', 'partial', null,
    ])('when the app component install is %s', (installType) => {
      beforeEach(() => {
        sideloadAppSpy.mockResolvedValueOnce(installType === null ? null : { installType });
      });

      describe.each([
        'full', 'partial', null,
      ])('and the companion component install is %s', (installType) => {
        beforeEach(() => {
          sideloadCompanionSpy.mockResolvedValueOnce(installType === null ? null : { installType });
          return doInstall();
        });

        it('sideloads the app', () => {
          expect(sideloadAppSpy).toBeCalled();
        });

        it('sideloads the companion', () => {
          expect(sideloadCompanionSpy).toBeCalled();
        });

        it('launches the app', () => {
          expect(mockDevice.host.launchAppComponent).toBeCalled();
        });
      });
    });
  });
});

describe('when a companion-only app is loaded', () => {
  beforeEach(() => {
    appContext.appPackage = mockAppPackageCompanionOnly as any;
  });

  it('connects a phone if no phone is connected', async () => {
    await doInstall();
    expectConnect('phone');
  });

  describe('when a phone is connected', () => {
    beforeEach(() => {
      hostConnections.companionHost = mockPhone as any;
      return doInstall();
    });

    it('sideloads the companion', () => {
      expect(sideloadCompanionSpy).toBeCalled();
    });
  });
});

describe('build option', () => {
  it('calls the build action when the --build option is provided', async () => {
    await cli.exec('install --build');
    expect(buildAction).toBeCalledWith(expect.anything());
  });

  it('calls the build action when the -b option is provided', async () => {
    await cli.exec('install -b');
    expect(buildAction).toBeCalledWith(expect.anything());
  });

  it('does not call the build action if the option is not provided', async () => {
    await cli.exec('install');
    expect(buildAction).not.toBeCalled();
  });

  it('does not call the build option if a packagePath is provided', async () => {
    await cli.exec('install app.fba --build');
    expect(buildAction).not.toBeCalled();
  });
});
