/*
 * Copyright 2022, Polytechnique Montreal and contributors
 *
 * This file is licensed under the MIT License.
 * License text available at https://opensource.org/licenses/MIT
 */
import MockDate from 'mockdate';
import moment from 'moment';
import { sanitizeUserAttributes } from '../user';
import { getHomePage } from '../userPermissions';

import User from '../user';
import { UserAttributes } from '../../users/user';
import usersDbQueries from '../../../models/db/users.db.queries';

// Mocked date: 2020-09-23, the day we first mocked a date in Transition...
MockDate.set(new Date(1600833600000));

jest.mock('../userPermissions', () => {
    const originalModule =
        jest.requireActual<typeof import('../userPermissions')>('../userPermissions');

    return {
        __esModule: true, // Use it when dealing with esModules
        ...originalModule,
        getHomePage: jest.fn()
    };
});
jest.mock('../../../models/db/users.db.queries', () => ({
    update: jest.fn(),
    find: jest.fn()
}));

const mockedGetHomePage = getHomePage as jest.MockedFunction<typeof getHomePage>;

const saveFct = usersDbQueries.update as jest.MockedFunction<typeof usersDbQueries.update>;
const findFct = usersDbQueries.find as jest.MockedFunction<typeof usersDbQueries.find>

const defaultUserId = 5;
const defaultUuid = 'arbitrary';

beforeEach(() => {
    saveFct.mockClear();
    findFct.mockClear();
    mockedGetHomePage.mockClear();
});

describe('Account confirmation', () => {
    test('Test valid token confirmation', async () => {
        const token = "thisisanarbitraytoken";
        findFct.mockResolvedValueOnce({
            id: defaultUserId,
            uuid: defaultUuid,
            confirmation_token: token,
            is_confirmed: false
        });
        const result = await User.confirmAccount(token);
        expect(result).toEqual('Confirmed');
        expect(findFct).toHaveBeenCalledTimes(1);
        expect(findFct).toHaveBeenCalledWith({ confirmation_token: token });
        expect(saveFct).toHaveBeenCalledTimes(1);
        expect(saveFct).toHaveBeenCalledWith(defaultUserId, { confirmation_token: null, is_confirmed: true });
        
    });
    
    test('Test valid token with callback', async () => {
        const token = "thisisanarbitraytoken";
        findFct.mockResolvedValueOnce({
            id: defaultUserId,
            uuid: defaultUuid,
            confirmation_token: token,
            is_confirmed: false
        })
        const callback = jest.fn();
        const result = await User.confirmAccount(token, callback);
        expect(result).toEqual('Confirmed');
        expect(findFct).toHaveBeenCalledTimes(1);
        expect(findFct).toHaveBeenCalledWith({ confirmation_token: token });
        expect(saveFct).toHaveBeenCalledTimes(1);
        expect(saveFct).toHaveBeenCalledWith(defaultUserId, { confirmation_token: null, is_confirmed: true });
        expect(callback).toHaveBeenCalled();
    });
    
    test('Test invalid token confirmation', async () => {
        const token = "thisisanarbitraytoken";
        findFct.mockResolvedValueOnce(undefined)
        const result = await User.confirmAccount(token);
        expect(result).toEqual('NotFound');
        expect(findFct).toHaveBeenCalledTimes(1);
        expect(findFct).toHaveBeenCalledWith({ confirmation_token: token });
        expect(saveFct).toHaveBeenCalledTimes(0);
    });
});

describe('Password verification', () => {
    test('Test password verification with string password', async () => {
        const password = "test";
        const user = new User({
            id: defaultUserId,
            uuid: 'arbitrary',
            password: User.encryptPassword(password),
        });
        expect(await user.verifyPassword(password)).toBeTruthy();
        expect(await user.verifyPassword('')).toBeFalsy;
        expect(await user.verifyPassword('Other password')).toBeFalsy();
    });
    
    test('Test password verification with null password', async () => {
        const user = new User({
            id: defaultUserId,
            uuid: 'arbitrary',
            password: null,
        });
        expect(await user.verifyPassword('')).toBeFalsy;
        expect(await user.verifyPassword('Other password')).toBeFalsy();
    })
    
    test('Test password verification with default user', async () => {
        const user = new User({
            id: defaultUserId,
            uuid: 'arbitrary'
        });
        expect(await user.verifyPassword('')).toBeFalsy;
        expect(await user.verifyPassword('Other password')).toBeFalsy();
    })
})

test('Test get display name', async () => {
    const username = 'test';
    const first_name = 'first';
    const last_name = 'last';
    const email = 'test@test.com';
    let user = new User({
        id: defaultUserId,
        uuid: 'arbitrary',
        password: null,
    });
    expect(user.getDisplayName()).toEqual('');

    user = new User({
        id: defaultUserId,
        uuid: 'arbitrary',
        password: null,
        username,
        email
    });
    expect(user.getDisplayName()).toEqual(username);

    user = new User({
        id: defaultUserId,
        uuid: 'arbitrary',
        password: null,
        username,
        first_name
    });
    expect(user.getDisplayName()).toEqual(first_name);

    user = new User({
        id: defaultUserId,
        uuid: 'arbitrary',
        password: null,
        username,
        last_name
    });
    expect(user.getDisplayName()).toEqual(last_name);

    user = new User({
        id: defaultUserId,
        uuid: 'arbitrary',
        password: null,
        username,
        first_name,
        last_name
    });
    expect(user.getDisplayName()).toEqual(first_name + ' ' + last_name);

    user = new User({
        id: defaultUserId,
        uuid: 'arbitrary',
        password: null,
        username: email,
        email
    });
    expect(user.getDisplayName()).toEqual('');

});

test('sanitize', () => {
    const username = 'test';
    const first_name = 'first';
    const last_name = 'last';
    const id = 100;
    const uuid = 'arbitrary';
    const preferences = { pref1: 'abc', pref2: true };
    let user = new User({
        id,
        uuid,
        password: null,
        username,
        first_name,
        last_name
    });
    // Set no home page
    mockedGetHomePage.mockReturnValueOnce(undefined);
    expect(user.sanitize()).toEqual({ id,
        username,
        firstName: first_name,
        lastName: last_name,
        preferences: {},
        email: undefined,
        serializedPermissions: [],
        homePage: undefined
    });
    expect(mockedGetHomePage).toHaveBeenLastCalledWith(user.attributes);

    // Make sure there is no private data after sanitize
    user = new User({
        id,
        password: null,
        username,
        first_name,
        last_name,
        private_token: 'abcefghi',
        preferences,
        is_admin: true
    } as any);
    // Set no home page
    const homePage = '/homePage';
    mockedGetHomePage.mockReturnValueOnce(homePage);
    expect(user.sanitize()).toEqual({
        id,
        username,
        firstName: first_name,
        lastName: last_name,
        preferences,
        email: undefined,
        serializedPermissions: [ [ 'manage', 'all' ] ],
        homePage
    });
    expect(mockedGetHomePage).toHaveBeenLastCalledWith(user.attributes);
});

test('sanitizeUserAttributes', () => {
    const username = 'test';
    const first_name = 'first';
    const last_name = 'last';
    const id = 4;
    const preferences = { pref1: 'abc', pref2: true };
    let userAttributes = {
        id,
        uuid: 'arbitrary',
        username,
        first_name,
        last_name
    } as UserAttributes;
    expect(sanitizeUserAttributes(userAttributes)).toEqual({
        id,
        username,
        firstName: first_name,
        lastName: last_name,
        preferences: {},
        email: undefined,
        serializedPermissions: []
    });

    // Make sure there is no private data after sanitize
    userAttributes = {
        id,
        uuid: 'arbitrary',
        password: '$fdafdsafdafads',
        username,
        first_name,
        last_name,
        password_reset_token: 'abcefghi',
        preferences,
        is_admin: true
    };
    expect(sanitizeUserAttributes(userAttributes)).toEqual({
        id,
        username,
        firstName: first_name,
        lastName: last_name,
        preferences,
        email: undefined,
        serializedPermissions: [ [ 'manage', 'all' ] ]
    });
});

describe('Reset password', () => {
    test('Reset password OK', async () => {
        const token = 'thisisanarbitraytoken';
        const newPassword = 'newPassword';
        findFct.mockResolvedValueOnce({
            id: defaultUserId,
            uuid: defaultUuid,
            password_reset_token: token,
            password_reset_expire_at: moment(Date.now() + 86400000),
            password: User.encryptPassword('forgotten')
        });
        const result = await User.resetPassword(token, newPassword);
        expect(result).toEqual('PasswordChanged');

        expect(findFct).toHaveBeenCalledTimes(1);
        expect(findFct).toHaveBeenCalledWith({ password_reset_token: token });
        expect(saveFct).toHaveBeenCalledTimes(1);
        expect(saveFct).toHaveBeenCalledWith(defaultUserId, {
            password: expect.anything(),
            password_reset_expire_at: null,
            password_reset_token: null
        });
    });
    
    test('Reset password expired', async () => {
        const token = 'thisisanarbitraytoken';
        const newPassword = 'newPassword';
        findFct.mockResolvedValueOnce({
            id: defaultUserId,
            uuid: defaultUuid,
            password_reset_token: token,
            password_reset_expire_at: moment(Date.now() - 86400000),
            password: User.encryptPassword('forgotten')
        });
        const result = await User.resetPassword(token, newPassword);
        expect(result).toEqual('Expired');
        expect(saveFct).not.toHaveBeenCalled();
    });
    
    test('Reset password not found', async () => {
        const token = 'thisisanarbitraytoken';
        const newPassword = 'newPassword';
        findFct.mockResolvedValueOnce(undefined);
        const result = await User.resetPassword(token, newPassword);
        expect(result).toEqual('NotFound');
        expect(saveFct).not.toHaveBeenCalled();
    });
    
    test('Reset password, no password', async () => {
        const token = 'thisisanarbitraytoken';
        findFct.mockResolvedValue({
            id: defaultUserId,
            uuid: defaultUuid,
            password_reset_token: token,
            password_reset_expire_at: moment(Date.now() + 86400000),
            password: User.encryptPassword('forgotten')
        });
        let result = await User.resetPassword(token);
        expect(result).toEqual('Confirmed');
        expect(saveFct).not.toHaveBeenCalled();
    
        result = await User.resetPassword(token, undefined);
        expect(result).toEqual('Confirmed');
        expect(saveFct).not.toHaveBeenCalled();
    });
});

describe('Update attributes', () => {

    const baseUserAttribs = {
        id: defaultUserId,
        uuid: 'arbitrary',
        first_name: 'Foo',
        last_name: 'Bar',
        is_admin: false
    }
    let baseUser = new User(baseUserAttribs);

    beforeEach(() => {
        baseUser = new User(baseUserAttribs);
    })

    test('Permissions', () => {
        // Not right type
        let permissions: any = 'string';
        baseUser.updateAndSanitizeAttributes({ permissions });
        expect(baseUser.attributes.permissions).toEqual(undefined);

        // Correct permissions
        permissions = { aRole: true, otherRole: false };
        baseUser.updateAndSanitizeAttributes({ permissions });
        expect(baseUser.attributes.permissions).toEqual(permissions);

        // other wrong permissions
        const wrongPermissions = 2;
        baseUser.updateAndSanitizeAttributes({ permissions: wrongPermissions });
        expect(baseUser.attributes.permissions).toEqual(permissions);
    });

    test('is_admin', () => {
        // Bad but truthy value
        baseUser.updateAndSanitizeAttributes({ is_admin: 'truthy value' });
        expect(baseUser.attributes.is_admin).toEqual(false);

        // true
        baseUser.updateAndSanitizeAttributes({ is_admin: true });
        expect(baseUser.attributes.is_admin).toEqual(true);

        // false
        baseUser.updateAndSanitizeAttributes({ is_admin: false });
        expect(baseUser.attributes.is_admin).toEqual(false);

        // true as string
        baseUser.updateAndSanitizeAttributes({ is_admin: 'true' });
        expect(baseUser.attributes.is_admin).toEqual(true);

        // not is_admin value
        baseUser.updateAndSanitizeAttributes({ });
        expect(baseUser.attributes.is_admin).toEqual(true);

        // truthy number
        baseUser.updateAndSanitizeAttributes({ is_admin: 1 });
        expect(baseUser.attributes.is_admin).toEqual(false);
    });

    test('First/last name', () => {
        // Valid strings
        const name = 'Test'
        baseUser.updateAndSanitizeAttributes({ first_name: name, last_name: name });
        expect(baseUser.attributes.last_name).toEqual(name);
        expect(baseUser.attributes.first_name).toEqual(name);

        // Other value types, should not update
        baseUser.updateAndSanitizeAttributes({ first_name: { name: 'something' }, last_name: 1 });
        expect(baseUser.attributes.last_name).toEqual(name);
        expect(baseUser.attributes.first_name).toEqual(name);

        // First name ok, last name wrong type, only first_name updated
        baseUser.updateAndSanitizeAttributes({ first_name: baseUserAttribs.first_name, last_name: 1 });
        expect(baseUser.attributes.last_name).toEqual(name);
        expect(baseUser.attributes.first_name).toEqual(baseUserAttribs.first_name);
    });

    test('Test random attributes', () => {
        baseUser.updateAndSanitizeAttributes({ arbitrary: 'some value', other: 'abc' });
        expect(baseUser.attributes).toEqual(baseUserAttribs);
    })

});
