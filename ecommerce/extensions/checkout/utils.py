import json
import logging

import requests
from babel.numbers import format_currency
from django.conf import settings
from django.utils.translation import get_language, to_locale
from edx_rest_api_client.client import EdxRestApiClient
from oscar.core.loading import get_model
from rest_framework import status
from slumber.exceptions import SlumberHttpBaseException

from ecommerce.extensions.payment.models import SDNCheckFailure

Basket = get_model('basket', 'Basket')

logger = logging.getLogger(__name__)


def get_credit_provider_details(access_token, credit_provider_id, site_configuration):
    """ Returns the credit provider details from LMS.

    Args:
        access_token (str): JWT access token
        credit_provider_id (str): Identifier for the provider
        site_configuration (SiteConfiguration): Ecommerce Site Configuration

    Returns: dict
    """
    try:
        return EdxRestApiClient(
            site_configuration.build_lms_url('api/credit/v1/'),
            oauth_access_token=access_token
        ).providers(credit_provider_id).get()
    except (requests.exceptions.ConnectionError, SlumberHttpBaseException, requests.exceptions.Timeout):
        logger.exception('Failed to retrieve credit provider details for provider [%s].', credit_provider_id)
        return None


def get_receipt_page_url(site_configuration, order_number=None):
    """ Returns the receipt page URL.

    Args:
        order_number (str): Order number
        site_configuration (SiteConfiguration): Site Configuration containing the flag for enabling Otto receipt page.

    Returns:
        str: Receipt page URL.
    """
    if site_configuration.enable_otto_receipt_page:
        return site_configuration.build_ecommerce_url('{base_url}{order_number}'.format(
            base_url=settings.RECEIPT_PAGE_PATH,
            order_number=order_number if order_number else ''
        ))
    return site_configuration.build_lms_url(
        '{base_url}{order_number}'.format(
            base_url='/commerce/checkout/receipt',
            order_number='?orderNum={}'.format(order_number) if order_number else ''
        )
    )


def add_currency(amount):
    """ Adds currency to the price amount.

    Args:
        amount (Decimal): Price amount

    Returns:
        str: Formatted price with currency.
    """
    return format_currency(
        amount,
        settings.OSCAR_DEFAULT_CURRENCY,
        format=u'#,##0.00',
        locale=to_locale(get_language())
    )


def sdn_check(request, full_name, address):
    """
    Call SDN check API to check if the user is on the US Treasury Department OFAC list.

    Arguments:
        request (Request): The request object made to the view.
        full_name(str): Full name of the user who is checked.
        address(str): User's address.
    Returns:
        result (Bool): Whether or not there is a match.
    """
    site_config = request.site.siteconfiguration
    basket = Basket.get_basket(request.user, request.site)
    response = requests.get(site_config.sdn_check_url(full_name, address))

    if response.status_code != status.HTTP_200_OK:
        logger.info(
            'Unable to connect to US Treasury SDN API. Status code [%d] with message: %s',
            response.status_code, response.content
        )
        return True
    elif json.loads(response.content)['total'] == 0:
        return True
    else:
        SDNCheckFailure.objects.create(
            full_name=full_name,
            sdn_check_response=response.content,
            basket=basket
        )
        logger.info('SDN check failed for user [%s] on basket id [%d]', full_name, basket.id)
        return False
