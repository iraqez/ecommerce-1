import json

import ddt
import httpretty
import mock
import requests
from django.test import RequestFactory
from oscar.test.factories import BasketFactory

from ecommerce.extensions.checkout.utils import sdn_check, get_credit_provider_details
from ecommerce.extensions.payment.models import SDNCheckFailure
from ecommerce.tests.factories import SiteConfigurationFactory
from ecommerce.tests.testcases import TestCase


@ddt.ddt
class UtilTests(TestCase):
    def setUp(self):
        super(UtilTests, self).setUp()
        self.credit_provider_id = 'HGW'
        self.credit_provider_name = 'Hogwarts'
        self.body = {'display_name': self.credit_provider_name}

    def get_credit_provider_details_url(self, credit_provider_id):
        """
        Formats the relative path to the credit provider details API endpoint.

        Args:
            credit_provider_id (str): Credit provider ID for which the details are fetched

        Returns:
            Relative URL to the LMS Credit Provider details API endpoint.
        """
        return 'api/credit/v1/providers/{credit_provider_id}/'.format(credit_provider_id=credit_provider_id)

    @httpretty.activate
    def test_get_credit_provider_details(self):
        """ Check that credit provider details are returned. """
        httpretty.register_uri(
            httpretty.GET,
            self.site.siteconfiguration.build_lms_url(self.get_credit_provider_details_url(self.credit_provider_id)),
            body=json.dumps(self.body),
            content_type="application/json"
        )
        provider_data = get_credit_provider_details(
            self.access_token,
            self.credit_provider_id,
            self.site.siteconfiguration
        )
        self.assertDictEqual(provider_data, self.body)

    @httpretty.activate
    def test_get_credit_provider_details_unavailable_request(self):
        """ Check that None is returned on Bad Request response. """
        httpretty.register_uri(
            httpretty.GET,
            self.site.siteconfiguration.build_lms_url(self.get_credit_provider_details_url(self.credit_provider_id)),
            status=400
        )
        provider_data = get_credit_provider_details(
            self.access_token,
            self.credit_provider_id,
            self.site.siteconfiguration
        )
        self.assertEqual(provider_data, None)

    @ddt.data(requests.exceptions.ConnectionError, requests.exceptions.Timeout)
    def test_exceptions(self, exception):
        """ Verify the function returns None when a request exception is raised. """
        with mock.patch.object(requests, 'get', mock.Mock(side_effect=exception)):
            self.assertIsNone(
                get_credit_provider_details(
                    self.access_token,
                    self.credit_provider_id,
                    self.site.siteconfiguration
                )
            )


class SDNCheckTests(TestCase):
    """ Tests for the SDN check function. """
    def setUp(self):
        super(SDNCheckTests, self).setUp()
        self.request = RequestFactory()
        self.request.COOKIES = {}
        self.username = 'Dr. Evil'
        self.address = 'Top-secret lair'
        self.request.user = self.create_user(full_name=self.username)
        site_configuration = SiteConfigurationFactory(
            partner__name='Tester',
            enable_sdn_check=True,
            sdn_api_url='http://sdn-test.fake',
            sdn_api_key='fake-key',
            sdn_api_list='SDN,TEST'
        )
        self.request.site = site_configuration.site

    def mock_sdn_response(self, response, status_code=200):
        """ Mock the SDN check API endpoint response. """
        httpretty.register_uri(
            httpretty.GET,
            self.request.site.siteconfiguration.sdn_check_url(self.username, self.address),
            status=status_code,
            body=json.dumps(response),
            content_type='application/json'
        )

    def assert_sdn_check_failure(self, basket, response):
        """ Assert an SDN check failure is logged and has the correct values. """
        self.assertEqual(SDNCheckFailure.objects.count(), 1)
        sdn_object = SDNCheckFailure.objects.first()
        self.assertEqual(sdn_object.full_name, self.username)
        self.assertEqual(sdn_object.sdn_check_response, response)
        self.assertEqual(sdn_object.basket, basket)

    @httpretty.activate
    def test_sdn_check_connection_error(self):
        """ Verify an SDN failure is logged in case of a connection error. """
        self.mock_sdn_response({}, status_code=400)
        BasketFactory(owner=self.request.user, site=self.request.site)
        self.assertEqual(SDNCheckFailure.objects.count(), 0)
        self.assertTrue(sdn_check(self.request, self.username, self.address))

    @httpretty.activate
    def test_sdn_check_match(self):
        """ Verify the SDN check returns false for a match and records it. """
        sdn_response = {'total': 1}
        self.mock_sdn_response(sdn_response)
        basket = BasketFactory(owner=self.request.user, site=self.request.site)
        self.assertEqual(SDNCheckFailure.objects.count(), 0)
        self.assertFalse(sdn_check(self.request, self.username, self.address))

        self.assert_sdn_check_failure(basket, json.dumps(sdn_response))

    @httpretty.activate
    def test_sdn_check_pass(self):
        """ Verify the SDN check returns true if the user passed. """
        self.mock_sdn_response({'total': 0})
        BasketFactory(owner=self.request.user, site=self.request.site)
        self.assertEqual(SDNCheckFailure.objects.count(), 0)
        self.assertTrue(sdn_check(self.request, self.username, self.address))
        self.assertEqual(SDNCheckFailure.objects.count(), 0)
