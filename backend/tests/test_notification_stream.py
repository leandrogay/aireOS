import asyncio

from app import notification_stream


def test_one_change_wakes_every_open_tab_once():
    first = notification_stream.subscribe()
    second = notification_stream.subscribe()
    try:
        notification_stream.broadcast()
        notification_stream.broadcast()  # a second change before either tab re-fetched

        assert first.qsize() == 1
        assert second.qsize() == 1
    finally:
        notification_stream.unsubscribe(first)
        notification_stream.unsubscribe(second)


def test_a_closed_tab_is_no_longer_woken():
    queue = notification_stream.subscribe()
    notification_stream.unsubscribe(queue)

    notification_stream.broadcast()

    assert queue.empty()


def test_a_woken_tab_can_be_woken_again_after_it_re_fetched():
    queue = notification_stream.subscribe()
    try:
        notification_stream.broadcast()
        asyncio.run(queue.get())
        notification_stream.broadcast()

        assert queue.qsize() == 1
    finally:
        notification_stream.unsubscribe(queue)
